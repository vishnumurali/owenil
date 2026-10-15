import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { adminClient, hasHostedConfig, pgClient, userClient } from '../../scripts/lib';
import { expensePayload } from '../sql/payload';
import { devEntitlementsMode, loadAccounts, login, logout, pageContent } from './helpers';

const accounts = loadAccounts();
test.skip(!hasHostedConfig() || !accounts, 'Needs Supabase settings in .env.local');
test.describe.configure({ mode: 'serial' });

let groupUrl = '';
let expenseUrl = '';

/** The app's path for the current page, without the site's base path ("/owenil/" on the web, "/" in the Android build). */
const BASE_PATH = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173/owenil/').pathname;
const appPath = (url: string) => new URL(url).pathname.slice(BASE_PATH.length).replace(/^\//, '');

test('1. registration, email verification (when required) and login', async ({ page }) => {
  const email = `register.${Date.now()}@e2e.owenil.test`;
  const password = 'E2e-pass-' + Math.random().toString(36).slice(2, 10) + '9';
  // A fresh, valid Indian mobile number (numbers are unique per account).
  const mobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  // Is "Confirm email" on? (Public Auth settings; it is switched off while testing.)
  const settings = (await (await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY! },
  })).json()) as { mailer_autoconfirm?: boolean };
  const verificationRequired = settings.mailer_autoconfirm !== true;

  if (verificationRequired) {
    // Never spend the project's tiny email allowance (2/hour on the built-in sender)
    // on a test: answer the sign-up request the way Supabase does once it has sent
    // the email. Verification itself is exercised for real below, without email.
    await page.route('**/auth/v1/signup**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: randomUUID(), aud: 'authenticated', role: '', email, confirmation_sent_at: new Date().toISOString(), user_metadata: {}, app_metadata: {}, identities: [] }),
      }),
    );
  }

  // (a) The sign-up form.
  await page.goto('register');
  await page.getByLabel('Your name').fill('E2E Newcomer');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile number').fill(`0${mobile.slice(0, 5)} ${mobile.slice(5)}`);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm').fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  if (verificationRequired) {
    await expect(page.getByText('Check your inbox')).toBeVisible();
    await page.unroute('**/auth/v1/signup**');
    // (b) Email verification: create the same pending sign-up server-side and get
    // the genuine verification link Supabase would email (no email is sent).
    const { data, error } = await adminClient().auth.admin.generateLink({
      type: 'signup', email, password, options: { data: { display_name: 'E2E Newcomer' }, redirectTo: new URL('auth/callback', page.url()).toString() },
    });
    expect(error).toBeNull();
    const db = await pgClient();
    const before = await db.query<{ confirmed: boolean }>('select email_confirmed_at is not null as confirmed from auth.users where email = $1', [email]);
    expect(before.rows[0]?.confirmed).toBe(false); // unverified accounts can't sign in yet
    await page.goto(data.properties!.action_link); // "click" the link in the email
    await expect.poll(async () => (await db.query<{ confirmed: boolean }>('select email_confirmed_at is not null as confirmed from auth.users where email = $1', [email])).rows[0]?.confirmed).toBe(true);
    await db.end();
    // (c) Log in with the verified account.
    await page.goto('login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  }

  // The new account (signed in straight away when verification is off) lands on onboarding,
  // which asks for the mobile number (kept from sign-up when it could be saved then).
  await expect(page.getByText('Let’s set you up')).toBeVisible();
  await page.getByLabel('Mobile number').fill(`+91 ${mobile}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Skip/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'E2E Newcomer' })).toBeVisible();
  const db2 = await pgClient();
  const saved = await db2.query<{ phone: string }>('select c.phone_e164 as phone from public.user_contact_info c join auth.users u on u.id = c.user_id where u.email = $1', [email]);
  await db2.end();
  expect(saved.rows[0]?.phone).toBe(`+91${mobile}`);
  await logout(page);

  // (d) The chosen password works for a fresh sign-in.
  await login(page, { email, password, name: 'E2E Newcomer', id: '' });
  await expect(page.getByRole('heading', { name: 'E2E Newcomer' })).toBeVisible();
  await logout(page);
});

test('2. group creation', async ({ page }) => {
  await login(page, accounts!.alice);
  await page.goto('groups/new');
  await page.getByLabel('Group name').fill('E2E Trip');
  await page.getByRole('button', { name: /E2E Bob/ }).click();
  await page.getByRole('button', { name: /E2E Carol/ }).click();
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}/);
  await page.keyboard.press('Escape'); // close the automatic invite dialog
  await expect(page.getByRole('heading', { name: 'E2E Trip' })).toBeVisible();
  await expect(page.getByText('3 members')).toBeVisible();
  groupUrl = appPath(page.url());
});

test('3–5. expense creation, split preview and balances (₹3,000 shared by three)', async ({ page }) => {
  await login(page, accounts!.alice);
  await page.goto(`expenses/new?group=${groupUrl.split('/')[1]}`);
  await page.getByLabel('Description').fill('Beach villa');
  await page.getByLabel('Amount').fill('3000');
  // Preview shows each participant's allocation before saving.
  const summary = page.locator('li', { hasText: '₹1,000.00' });
  await expect(summary).toHaveCount(3);
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page).toHaveURL(/\/expenses\/[0-9a-f-]{36}$/);
  expenseUrl = appPath(page.url());
  await expect(page.getByText('gets back ₹2,000.00')).toBeVisible();
  await expect(page.getByText('owes ₹1,000.00')).toHaveCount(2);
  await page.goto('dashboard');
  await expect(page.getByText('You are owed').locator('..').locator('..')).toContainText('₹2,000.00');
});

test('6a. a UPI ID can be saved, validated and shared with friends', async ({ page }) => {
  await login(page, accounts!.alice);
  await page.goto('settings');
  await page.getByLabel('UPI ID').fill('not a upi id');
  await page.getByRole('button', { name: 'Save UPI ID' }).click();
  await expect(page.getByText('Enter a UPI ID like name@bank')).toBeVisible();
  await page.getByLabel('UPI ID').fill('  E2E.Alice@OkAxis ');
  await page.getByRole('button', { name: 'Save UPI ID' }).click();
  await expect(page.getByText('UPI ID saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('UPI ID')).toHaveValue('e2e.alice@okaxis');
  await logout(page);
});

test('6. settlement recording (with Pay with UPI)', async ({ page }) => {
  await login(page, accounts!.bob);
  await page.goto(groupUrl);
  await page.getByRole('button', { name: 'Settle up' }).click();
  await page.getByLabel('Paid to').selectOption({ label: 'E2E Alice' });
  await page.getByLabel('Amount').fill('1000');
  // Alice shared her UPI ID: Bob gets a link for his UPI app and a QR code, amount filled in.
  await expect(page.getByText('Pay E2E Alice with UPI')).toBeVisible();
  const upiLink = page.getByRole('link', { name: 'Open UPI app' });
  await expect(upiLink).toHaveAttribute('href', /^upi:\/\/pay\?pa=e2e\.alice%40okaxis&pn=E2E%20Alice&am=1000\.00&cu=INR&tn=Owenil%20-%20E2E%20Trip$/);
  await expect(page.getByRole('img', { name: /UPI QR code to pay E2E Alice/ })).toBeVisible();
  await page.getByRole('button', { name: 'Record repayment' }).click();
  await expect(page.getByText('Repayment recorded')).toBeVisible();
  await page.goto('balances');
  await expect(page.getByText(/settled up|all settled/i).or(page.getByText('You owe'))).toBeVisible();
  await logout(page);
  await login(page, accounts!.alice);
  await page.goto(`${groupUrl}?tab=balances`);
  await page.getByRole('radio', { name: 'Balances' }).click();
  await expect(page.getByText('gets back').first().locator('..')).toContainText('₹1,000.00');
});

test('7. expense editing re-applies the split exactly once', async ({ page }) => {
  await login(page, accounts!.alice);
  await page.goto(`${expenseUrl}/edit`);
  await page.getByLabel('Amount').fill('3600');
  await expect(page.locator('li', { hasText: '₹1,200.00' })).toHaveCount(3);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('gets back ₹2,400.00')).toBeVisible();
  // Bob has repaid ₹1,000 → Alice is owed 2,400 − 1,000 = ₹1,400 overall.
  await page.goto('dashboard');
  await expect(page.getByText('You are owed').locator('..').locator('..')).toContainText('₹1,400.00');
  await page.goto(expenseUrl);
  await expect(page.getByText('v2')).toBeVisible();
});

test('7b. comments reach the other people on the expense', async ({ page }) => {
  await login(page, accounts!.bob);
  await page.goto(expenseUrl);
  await page.getByRole('textbox', { name: 'Comment' }).fill('Is the villa price right?');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByText('Is the villa price right?')).toBeVisible();
  await expect(page.getByText(/infinite recursion|row-level security/i)).toHaveCount(0);
  await logout(page);
  await login(page, accounts!.alice);
  await page.goto(expenseUrl);
  await expect(page.getByText('Is the villa price right?')).toBeVisible();
});

test('8. premium development access', async ({ page }) => {
  await login(page, accounts!.alice);
  await page.goto('plus');
  // In "Plus for everyone" testing mode new accounts start on Plus: switch to Free first.
  if ((await devEntitlementsMode()) === 'everyone') {
    await expect(page.getByText('Plus is active')).toBeVisible();
    await page.getByRole('button', { name: 'Switch back to Free' }).click();
    await expect(page.getByRole('button', { name: 'Enable Plus for testing' })).toBeVisible();
  }
  await page.goto('budgets');
  await expect(page.getByText('Budgets & alerts is part of Owenil Plus')).toBeVisible();
  await page.goto('plus');
  await page.getByRole('button', { name: 'Enable Plus for testing' }).click();
  await expect(page.getByText('Plus is active')).toBeVisible();
  await page.goto('budgets');
  await page.getByRole('button', { name: 'New budget' }).first().click();
  await page.getByLabel('Limit').fill('5000');
  await page.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByText('of ₹5,000.00')).toBeVisible();
});

test('9. unauthorized data access is blocked', async ({ page }) => {
  await login(page, accounts!.xena);
  await page.goto(groupUrl);
  await expect(page.getByText('Group not found')).toBeVisible();
  await page.goto(expenseUrl);
  await expect(page.getByText('Expense not found')).toBeVisible();
  await page.goto('plus');
  if ((await devEntitlementsMode()) === 'everyone') {
    // Testing mode: every account, including this one, has Plus.
    await expect(page.getByText('Plus is active')).toBeVisible();
  } else {
    // The premium switch is refused by the database for non-testers.
    await expect(page.getByText(/Not available for this account/)).toBeVisible();
  }
});

test('10. data persists across a browser refresh and new session', async ({ page, context }) => {
  await login(page, accounts!.alice);
  await page.goto(expenseUrl);
  await expect(page.getByRole('heading', { name: 'Beach villa' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Beach villa' })).toBeVisible();
  await expect(page.getByText('₹3,600.00').first()).toBeVisible();
  // Session survives a brand-new tab.
  const page2 = await context.newPage();
  await page2.goto('dashboard');
  await expect(page2).toHaveURL(/\/dashboard/);
  await expect(page2.getByRole('heading', { name: 'E2E Alice' })).toBeVisible();
});

test('11. moving between pages by clicking always shows the page', async ({ page }) => {
  await login(page, accounts!.alice);
  const rail = page.getByRole('navigation', { name: 'Main' });
  // Main places are on the rail; the rest open from the "All" launcher.
  const pages: [string, RegExp, 'rail' | 'launcher'][] = [
    ['Groups', /Groups/, 'rail'], ['Expenses', /Expenses/, 'rail'], ['Balances', /Balances/, 'rail'], ['Analytics', /Analytics/, 'launcher'],
    ['Repayments', /Repayments/, 'launcher'], ['Friends', /Friends/, 'rail'], ['Recurring', /Recurring/, 'launcher'], ['Home', /E2E Alice/, 'rail'],
  ];
  for (const [link, heading, where] of pages) {
    if (where === 'rail') {
      await rail.getByRole('link', { name: link, exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await page.getByRole('navigation', { name: 'All sections' }).getByRole('link', { name: link, exact: true }).click();
    }
    await expect(page.locator('main h1').first()).toContainText(heading);
    // Present AND visible: a stuck page transition used to leave it at opacity 0.
    await expect(pageContent(page)).toHaveCSS('opacity', '1');
  }
  await page.getByRole('button', { name: 'Quick actions' }).click();
  await page.getByRole('navigation', { name: 'Quick actions' }).getByRole('link', { name: /^Add expense/ }).click();
  await expect(page.getByRole('heading', { name: 'Add an expense' })).toBeVisible();
  await expect(pageContent(page)).toHaveCSS('opacity', '1');
  await page.goBack();
  await expect(page.locator('main h1').first()).toContainText(/E2E Alice/);
  await expect(pageContent(page)).toHaveCSS('opacity', '1');
});

/** Pretend the user switched to their UPI app and came back (what a phone does after paying). */
async function leaveAndReturn(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const set = (v: string) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    set('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    set('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('12. pay one expense with UPI, confirm on return, and it shows as paid', async ({ page }) => {
  await login(page, accounts!.carol);
  await page.goto(expenseUrl);
  // Carol's share of the ₹3,600 villa is ₹1,200, all still owed to Alice.
  await page.getByRole('button', { name: 'Pay E2E Alice ₹1,200.00' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Pay E2E Alice for “Beach villa”' })).toBeVisible();
  const upiLink = dialog.getByRole('link', { name: 'Open UPI app' });
  await expect(upiLink).toHaveAttribute('href', 'upi://pay?pa=e2e.alice%40okaxis&pn=E2E%20Alice&am=1200.00&cu=INR&tn=Owenil%20-%20Beach%20villa');
  // Tap "Open UPI app" (the external app can't open in a test browser), then come back.
  await upiLink.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()));
  await upiLink.click();
  await leaveAndReturn(page);
  await expect(dialog.getByText('Did your payment of ₹1,200.00 to E2E Alice go through?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Yes, mark as paid' }).click();
  await expect(dialog.getByText('Marked as paid')).toBeVisible();
  await expect(page.getByText('Paid E2E Alice', { exact: true })).toBeVisible();
  // The expenses list shows it as paid too.
  await page.goto('expenses');
  await expect(page.locator('div', { has: page.getByRole('link', { name: /Beach villa/ }) }).getByText('Paid', { exact: true }).first()).toBeVisible();
});

test('13. Pay tab combines everything owed to one person into one payment', async ({ page }) => {
  // Outside any group, Alice also paid ₹500 for snacks shared with Bob → Bob owes ₹250 more.
  const alice = await userClient(accounts!.alice.email, accounts!.alice.password);
  const { error } = await alice.client.rpc('create_expense', {
    p_payload: expensePayload({ amount: 50000, payers: [[accounts!.alice.id, 50000]], participants: [accounts!.alice.id, accounts!.bob.id], description: 'Snacks' }),
    p_idempotency_key: `e2e-snacks-${Date.now()}`,
  });
  expect(error).toBeNull();

  await login(page, accounts!.bob);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pay', exact: true }).click();
  // ₹200 left from the villa (E2E Trip) + ₹250 for snacks (between friends) = ₹450.
  await expect(page.getByText('2 balances combined')).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₹450.00' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('E2E Trip')).toBeVisible();
  await expect(dialog.getByText('Between friends')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open UPI app' })).toHaveAttribute('href', 'upi://pay?pa=e2e.alice%40okaxis&pn=E2E%20Alice&am=450.00&cu=INR&tn=Owenil%20-%20settle%20up');
  await dialog.getByRole('button', { name: 'I’ve paid — mark as paid' }).click();
  await dialog.getByRole('button', { name: 'Yes, mark as paid' }).click();
  await expect(dialog.getByText('Marked as paid')).toBeVisible();
  await expect(page.getByText('You don’t owe anyone')).toBeVisible();
  // Both balances with Alice are now zero.
  await page.goto('balances');
  await expect(page.getByText(/settled up/i).first()).toBeVisible();
  await logout(page);
  await login(page, accounts!.alice);
  await expect(page.getByText('You are owed').locator('..').locator('..')).toContainText('₹0.00');
});

test('14. add a friend by email or phone: registered people can be added, others invited', async ({ page }) => {
  await login(page, accounts!.alice);
  await page.goto('friends');
  await page.getByRole('button', { name: 'Add friend' }).click();
  const dialog = page.getByRole('dialog');
  // A registered person, found by email (case doesn't matter): shown, and can be added.
  await dialog.getByLabel('Email or phone number').fill(accounts!.xena.email.toUpperCase());
  await dialog.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(dialog.getByTestId('person-found')).toContainText('E2E Xena');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('Request sent')).toBeVisible();
  // Someone who isn't on Owenil: "Not registered", with ready-made invitations.
  const unknown = `98765${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`;
  await dialog.getByLabel('Email or phone number').fill(unknown);
  await dialog.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(dialog.getByTestId('person-not-found')).toContainText('Not registered on Owenil');
  await dialog.getByRole('button', { name: /Invite them to Owenil/ }).click();
  await expect(dialog.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', new RegExp(`^https://wa\\.me/91${unknown}\\?text=`));
  await expect(dialog.getByRole('link', { name: 'SMS' })).toHaveAttribute('href', new RegExp(`^sms:\\+91${unknown}\\?&body=`));
  await page.keyboard.press('Escape');
  await logout(page);
  // Xena sees the friend request.
  await login(page, accounts!.xena);
  await page.goto('friends');
  await expect(page.getByText('Friend requests')).toBeVisible();
  await expect(page.getByText('E2E Alice', { exact: true }).first()).toBeVisible();
});
