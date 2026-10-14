// Smoke test for the built APK on an Android emulator (run by CI):
//   node scripts/android-smoke.mjs path/to/Owenil.apk
// Installs and opens the app, checks the web app runs inside it as the Android
// build, that the native UPI plugin answers, and that pages fit the phone.
// Screenshots are written to android-smoke/ (uploaded as a CI artifact).
import { mkdirSync } from 'node:fs';
import { _android as android } from '@playwright/test';

const PKG = 'io.github.vishnumurali.owenil';
const GPAY = 'com.google.android.apps.nbu.paisa.user';
const apk = process.argv[2];
const OUT = 'android-smoke';
mkdirSync(OUT, { recursive: true });

function check(ok, label, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const [device] = await android.devices();
if (!device) throw new Error('No Android device or emulator found (adb devices is empty).');
console.log(`Device: ${device.model()} (${device.serial()})`);
await device.installApk(apk);
await device.shell(`am start -n ${PKG}/.MainActivity`);

const webview = await device.webView({ pkg: PKG }, { timeout: 90_000 });
const page = await webview.page();
await page.waitForSelector('text=Shared expenses', { timeout: 90_000 });
await device.screenshot({ path: `${OUT}/1-start.png` });
check(true, 'App opens and shows the Owenil start page');

const platform = await page.evaluate(() => window.Capacitor?.getPlatform?.());
check(platform === 'android', 'Runs as the Android build', `platform=${platform}`);

const call = (method, options) =>
  page.evaluate(
    async ([m, o]) => {
      try {
        return { ok: true, value: await window.Capacitor.nativePromise('Upi', m, o) };
      } catch (e) {
        return { ok: false, code: e?.code ?? null, message: String(e?.message ?? e) };
      }
    },
    [method, options],
  );
const gpay = await call('canPay', { package: GPAY });
check(gpay.ok && gpay.value?.available === false, 'Native UPI plugin answers (Google Pay is not on a test emulator)', JSON.stringify(gpay));
const pay = await call('pay', { uri: 'upi://pay?pa=test@upi&pn=Test&am=1.00&cu=INR', package: GPAY });
check(!pay.ok && pay.code === 'APP_NOT_FOUND', 'Pay with GPay explains when Google Pay is missing', JSON.stringify(pay));
const bad = await call('pay', { uri: 'https://example.com' });
check(!bad.ok && bad.code === 'INVALID_URI', 'Plugin refuses anything that is not a UPI payment link', JSON.stringify(bad));

// The sign-in page works inside the app and fits the phone's width.
await page.getByRole('link', { name: /sign in/i }).first().click();
await page.waitForSelector('text=Welcome back', { timeout: 30_000 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 1, 'Sign-in page fits the screen (no sideways scrolling)', `overflow=${overflow}px`);
const links = await page.evaluate(() => document.querySelectorAll('a[href^="http://localhost"], a[href^="https://localhost"]').length);
check(links === 0, 'No links point at the phone itself');
await device.screenshot({ path: `${OUT}/2-sign-in.png` });

await device.close();
console.log(process.exitCode ? 'Smoke test FAILED' : 'Smoke test passed');
