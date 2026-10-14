import { test, expect } from '@playwright/test';
import { adminClient, hasHostedConfig, pgClient } from '../../scripts/lib';
import { loadAccounts, login, logout } from './helpers';

const accounts = loadAccounts();
test.skip(!hasHostedConfig() || !accounts, 'Needs Supabase settings in .env.local');
test.describe.configure({ mode: 'serial' });

let groupUrl = '';
let expenseUrl = '';

test('1. registration, email verification and login', async ({ page }) => {
  const email = `register.${Date.now()}@e2e.owenil.test`;
  const password = 'E2e-pass-' + Math.random().toString(36).slice(2, 10) + '9';

  // (a) The real sign-up form reaches Supabase Auth and shows its answer. Test
  // addresses can't receive mail, so Supabase rejects them — the form must
  // surface that clearly rather than a generic/network error.
  await page.goto('register');
  await page.getByLabel('Your name').fill('E2E Newcomer');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm').fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Check your inbox').or(page.getByText(/is invalid|not authorized|Too many emails/i))).toBeVisible();
  await expect(page.getByText(/Can’t reach the server/)).toHaveCount(0);

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
  // First sign-in lands on onboarding.
  await expect(page.getByText('Let’s set you up')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Skip/ }).click();
  await expect(page).toHaveURL(/\/dashboard/);
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
  groupUrl = new URL(page.url()).pathname.replace(/^\/owenil\//, '').replace(/\?.*$/, '');
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
  expenseUrl = new URL(page.url()).pathname.replace(/^\/owenil\//, '');
  await expect(page.getByText('gets back ₹2,000.00')).toBeVisible();
  await expect(page.getByText('owes ₹1,000.00')).toHaveCount(2);
  await page.goto('dashboard');
  await expect(page.getByText('You are owed').locator('..').locator('..')).toContainText('₹2,000.00');
});

test('6. settlement recording', async ({ page }) => {
  await login(page, accounts!.bob);
  await page.goto(groupUrl);
  await page.getByRole('button', { name: 'Settle up' }).click();
  await page.getByLabel('Paid to').selectOption({ label: 'E2E Alice' });
  await page.getByLabel('Amount').fill('1000');
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

test('8. premium development access', async ({ page }) => {
  await login(page, accounts!.alice);
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
  // The premium switch is refused by the database for non-testers.
  await page.goto('plus');
  await expect(page.getByText(/Not available for this account/)).toBeVisible();
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
