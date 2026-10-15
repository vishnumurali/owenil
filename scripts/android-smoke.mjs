// Smoke test for the built APK on an Android emulator (run by CI):
//   node scripts/android-smoke.mjs path/to/Owenil.apk [path/to/FakeUpi.apk]
// Installs and opens the app, then talks to its WebView over the Chrome
// DevTools protocol (the channel chrome://inspect uses) to check that the web
// app runs as the Android build, that the native UPI plugin works and that
// pages fit the phone. With the test-only fake UPI app (android/fakeupi) it
// also checks the full payment round trip: Owenil opens the UPI app with the
// payment and reads the app's answer, as it does with Google Pay.
// Every wait has a time limit, so a problem fails the job with diagnostics
// instead of hanging it. Screenshots, the screen's text and the device log go
// to android-smoke/ (uploaded as a CI artifact). Needs Node 22+ and adb.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PKG = 'io.github.vishnumurali.owenil';
const FAKE_UPI = 'io.github.vishnumurali.owenil.fakeupi';
const GPAY = 'com.google.android.apps.nbu.paisa.user';
const PORT = 9333;
const OUT = 'android-smoke';
const [apk, fakeUpiApk] = process.argv.slice(2);
if (!apk) {
  console.error('Usage: node scripts/android-smoke.mjs path/to/Owenil.apk [path/to/FakeUpi.apk]');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk')]
  .find((dir) => dir && existsSync(join(dir, 'platform-tools')));
const ADB = sdk ? join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : 'adb';

const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${msg}`);
let failures = 0;
function check(ok, label, detail = '') {
  log(`${ok ? '✓' : '✗'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
}

function adb(args, { timeout = 60_000, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, { timeout, encoding: binary ? 'buffer' : 'utf8', maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`adb ${args.join(' ')}: ${err.killed ? `no answer after ${timeout / 1000}s` : err.message}${stderr ? ` ${stderr}`.trimEnd() : ''}`));
      else resolve(stdout);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(label, probe, timeout) {
  const end = Date.now() + timeout;
  let lastError;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (e) {
      lastError = e;
    }
    if (Date.now() > end) throw new Error(`Gave up after ${timeout / 1000}s waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
    await sleep(1000);
  }
}

/** Minimal Chrome DevTools protocol client for one page, with a time limit on every command. */
async function connectDevTools(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DevTools connection timed out')), 20_000);
    ws.addEventListener('open', () => (clearTimeout(timer), resolve()));
    ws.addEventListener('error', () => (clearTimeout(timer), reject(new Error('DevTools connection failed'))));
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (!msg.id) {
      for (const listener of listeners) listener(msg);
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(`${msg.error.message} (${msg.error.code})`));
    else entry.resolve(msg.result);
  });
  ws.addEventListener('close', () => {
    for (const entry of pending.values()) entry.reject(new Error('DevTools connection closed'));
    pending.clear();
  });
  const send = (method, params = {}, timeout = 30_000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} got no answer after ${timeout / 1000}s`));
      }, timeout);
      pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  /** Runs fn(arg) in the page and returns its (awaited, JSON) result. */
  const evaluate = async (fn, arg = null, timeout = 30_000) => {
    const res = await send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true }, timeout);
    if (res.exceptionDetails) throw new Error(`Page error: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    return res.result.value;
  };
  return { send, evaluate, onEvent: (fn) => listeners.push(fn), close: () => ws.close() };
}

async function screenshot(name) {
  try {
    writeFileSync(join(OUT, name), await adb(['exec-out', 'screencap', '-p'], { binary: true, timeout: 30_000 }));
    log(`  screenshot: ${OUT}/${name}`);
  } catch (e) {
    log(`  could not take ${name}: ${e.message}`);
  }
}

async function saveDiagnostics() {
  await screenshot('failure.png');
  try {
    await adb(['shell', 'uiautomator', 'dump', '/data/local/tmp/window.xml'], { timeout: 30_000 });
    const xml = await adb(['exec-out', 'cat', '/data/local/tmp/window.xml'], { timeout: 15_000 });
    writeFileSync(join(OUT, 'screen.xml'), xml);
    const texts = [...xml.matchAll(/(?:text|content-desc)="([^"]+)"/g)].map((m) => m[1]);
    log(`  text on screen: ${texts.slice(0, 30).join(' | ') || '(none)'}`);
  } catch (e) {
    log(`  could not read the screen: ${e.message}`);
  }
  try {
    const logcat = await adb(['logcat', '-d', '-v', 'time'], { timeout: 30_000 });
    writeFileSync(join(OUT, 'logcat.txt'), logcat);
    const lines = logcat.split('\n').filter((line) => /Capacitor|chromium|AndroidRuntime|owenil|FATAL/i.test(line));
    log(`  app log (last 40 matching lines):\n${lines.slice(-40).join('\n')}`);
  } catch (e) {
    log(`  could not read the device log: ${e.message}`);
  }
}

async function main() {
  await adb(['wait-for-device'], { timeout: 120_000 });
  const prop = async (name) => (await adb(['shell', 'getprop', name])).trim();
  log(`Device: ${await prop('ro.product.model')}, Android ${await prop('ro.build.version.release')} (API ${await prop('ro.build.version.sdk')})`);
  await waitFor('the package manager', async () => (await adb(['shell', 'pm', 'path', 'android'], { timeout: 15_000 })).includes('package:'), 120_000);

  const installed = await adb(['install', '-r', apk], { timeout: 240_000 });
  check(/Success/.test(installed), 'Owenil installs', installed.trim().split('\n').pop());
  if (fakeUpiApk) {
    const fake = await adb(['install', '-r', fakeUpiApk], { timeout: 240_000 });
    check(/Success/.test(fake), 'Test-only fake UPI app installs', fake.trim().split('\n').pop());
  }

  const started = await adb(['shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`], { timeout: 90_000 });
  log(`  ${started.trim().split('\n').join(' | ')}`);
  const pid = await waitFor('the app process', async () => (await adb(['shell', 'pidof', PKG], { timeout: 10_000 })).trim().split(/\s+/)[0], 60_000);
  const socket = `webview_devtools_remote_${pid}`;
  await waitFor(`the WebView debugging socket @${socket}`, async () => (await adb(['shell', 'cat', '/proc/net/unix'], { timeout: 15_000 })).includes(`@${socket}`), 60_000);
  await adb(['forward', `tcp:${PORT}`, `localabstract:${socket}`]);

  const target = await waitFor(
    'the app page in the WebView',
    async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(5_000) });
      const targets = await res.json();
      return targets.find((t) => t.type === 'page' && t.url.startsWith('https://localhost'));
    },
    60_000,
  );
  log(`  WebView page: ${target.url}`);
  const path = target.webSocketDebuggerUrl ? new URL(target.webSocketDebuggerUrl).pathname : `/devtools/page/${target.id}`;
  const page = await connectDevTools(`ws://127.0.0.1:${PORT}${path}`);
  const pageErrors = [];
  page.onEvent((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push(d.exception?.description ?? d.text);
    }
  });
  await page.send('Runtime.enable');
  const hasText = (text) => page.evaluate((t) => document.body?.innerText.includes(t) ?? false, text, 10_000);

  await waitFor('the start page ("Shared expenses")', () => hasText('Shared expenses'), 90_000);
  check(true, 'App opens and shows the Owenil start page');
  await screenshot('1-start.png');

  const platform = await page.evaluate(() => window.Capacitor?.getPlatform?.() ?? null);
  check(platform === 'android', 'Runs as the Android build', `platform=${platform}`);

  // The native UPI plugin, called through the same Capacitor bridge the app uses.
  const upi = (method, options) =>
    page.evaluate(
      async ([m, o]) => {
        try {
          return { ok: true, value: await window.Capacitor.nativePromise('Upi', m, o) };
        } catch (e) {
          return { ok: false, code: e?.code ?? null, message: String(e?.message ?? e) };
        }
      },
      [method, options],
      30_000,
    );
  const gpay = await upi('canPay', { package: GPAY });
  check(gpay.ok && gpay.value?.available === false, 'UPI plugin answers (Google Pay is not on a test emulator)', JSON.stringify(gpay));
  const noGpay = await upi('pay', { uri: 'upi://pay?pa=test@upi&pn=Test&am=1.00&cu=INR', package: GPAY });
  check(!noGpay.ok && noGpay.code === 'APP_NOT_FOUND', 'Pay with GPay explains when Google Pay is missing', JSON.stringify(noGpay));
  const notUpi = await upi('pay', { uri: 'https://example.com' });
  check(!notUpi.ok && notUpi.code === 'INVALID_URI', 'Plugin refuses anything that is not a UPI payment link', JSON.stringify(notUpi));

  if (fakeUpiApk) {
    const visible = await upi('canPay', { package: FAKE_UPI });
    check(visible.ok && visible.value?.available === true, 'Owenil can see an installed UPI app', JSON.stringify(visible));
    const paid = await upi('pay', { uri: 'upi://pay?pa=test@upi&pn=Test&am=12.34&cu=INR&tn=Owenil%20test', package: FAKE_UPI });
    check(
      paid.ok && /Status=SUCCESS/.test(paid.value?.response ?? '') && paid.value.response.includes('txnRef=FAKE-12.34'),
      'Pay opens the UPI app with the payment and reads its answer',
      JSON.stringify(paid),
    );
    const back = await waitFor('Owenil to come back to the front', () => page.evaluate(() => document.visibilityState === 'visible'), 30_000).catch(() => false);
    check(back, 'Owenil is back in front after paying');
    await screenshot('2-after-pay.png');
  }

  // The sign-in page works inside the app and fits the phone's width.
  const clicked = await page.evaluate(() => {
    const link = [...document.querySelectorAll('a[href$="/login"]')].find((a) => a.getClientRects().length > 0);
    link?.click();
    return link?.textContent?.trim() ?? null;
  });
  check(Boolean(clicked), 'Start page shows a sign-in link', `"${clicked}"`);
  await waitFor('the sign-in page ("Welcome back")', () => hasText('Welcome back'), 30_000);
  const layout = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    localhostLinks: document.querySelectorAll('a[href^="http://localhost"], a[href^="https://localhost"]').length,
  }));
  check(layout.overflow <= 1, 'Sign-in page fits the screen (no sideways scrolling)', `width=${layout.width}px, overflow=${layout.overflow}px`);
  check(layout.localhostLinks === 0, 'No links point at the phone itself');
  await screenshot('3-sign-in.png');

  // Plugins the app relies on are built in.
  const plugins = await page.evaluate(() => ['App', 'Browser', 'Upi', 'Contacts'].filter((p) => !window.Capacitor?.isPluginAvailable?.(p)));
  check(plugins.length === 0, 'Native plugins present (App, Browser, Upi, Contacts)', plugins.length ? `missing: ${plugins.join(', ')}` : '');

  // Phone contacts: add one to the emulator, allow access, read it through the plugin.
  try {
    await adb(['shell', 'content insert --uri content://com.android.contacts/raw_contacts --bind account_type:n: --bind account_name:n:']);
    const rawIds = [...(await adb(['shell', 'content query --uri content://com.android.contacts/raw_contacts --projection _id'])).matchAll(/_id=(\d+)/g)].map((m) => Number(m[1]));
    if (!rawIds.length) throw new Error('could not create a test contact');
    const rawId = Math.max(...rawIds);
    const addData = (mime, value) =>
      adb(['shell', `content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${rawId} --bind mimetype:s:${mime} --bind data1:s:'${value}'`]);
    await addData('vnd.android.cursor.item/name', 'Test Friend');
    await addData('vnd.android.cursor.item/phone_v2', '+91 98765 43210');
    await addData('vnd.android.cursor.item/email_v2', 'test.friend@example.com');
    await adb(['shell', 'pm', 'grant', PKG, 'android.permission.READ_CONTACTS']);
    const readContacts = () =>
      page.evaluate(async () => {
        try {
          return { ok: true, value: (await window.Capacitor.nativePromise('Contacts', 'getContacts', {})).contacts };
        } catch (e) {
          return { ok: false, code: e?.code ?? null, message: String(e?.message ?? e) };
        }
      }, null, 30_000);
    // Android links a new contact's details in the background, so it can take a moment to show up.
    let contacts = await readContacts();
    await waitFor('the new contact to be listed', async () => {
      contacts = await readContacts();
      return contacts.ok && contacts.value.some((c) => c.name === 'Test Friend');
    }, 20_000).catch(() => {});
    const friend = contacts.ok ? contacts.value.find((c) => c.name === 'Test Friend') : null;
    check(
      !!friend && friend.phones.includes('+91 98765 43210') && friend.emails.includes('test.friend@example.com'),
      'Contacts plugin reads the phone’s contacts (name, number, email)',
      JSON.stringify(friend ?? contacts),
    );
  } catch (e) {
    check(false, 'Contacts plugin reads the phone’s contacts (name, number, email)', e.message);
  }

  // App links: what Google sign-in and auth emails use to come back to the app.
  await adb(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', "'io.github.vishnumurali.owenil://auth/callback?error_description=App%20link%20test'", PKG], { timeout: 60_000 });
  const linked = await waitFor('the app link to open the sign-in callback', () => hasText('App link test'), 30_000).catch(() => false);
  check(linked, 'An app link opens Owenil on the right page (sign-in callback)');
  await screenshot('4-app-link.png');
  await adb(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', "'io.github.vishnumurali.owenil://auth/callback?code=not-a-real-code'", PKG], { timeout: 60_000 });
  const expired = await waitFor('an unusable sign-in code to be explained', () => hasText('expired or was already used'), 30_000).catch(() => false);
  check(expired, 'A used or invalid sign-in link is explained, not ignored');

  check(pageErrors.length === 0, 'No uncaught errors in the app', pageErrors.slice(0, 3).join(' | '));
  page.close();
}

const watchdog = setTimeout(async () => {
  log('✗ The smoke test took longer than 10 minutes');
  await saveDiagnostics();
  process.exit(1);
}, 10 * 60_000);

try {
  await main();
} catch (e) {
  failures++;
  log(`✗ ${e.message}`);
}
if (failures) await saveDiagnostics();
await adb(['forward', '--remove', `tcp:${PORT}`]).catch(() => {});
clearTimeout(watchdog);
log(failures ? `Smoke test FAILED (${failures} problem${failures === 1 ? '' : 's'})` : 'Smoke test passed');
process.exit(failures ? 1 : 0);
