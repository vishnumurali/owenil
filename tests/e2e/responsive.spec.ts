import { test, expect } from '@playwright/test';
import { loadAccounts, login, pageContent } from './helpers';

const accounts = loadAccounts();

// Phone-sized layout checks. The landing and auth pages need no account.
test('landing page renders on a phone without horizontal scroll', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: /Shared expenses/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('login page is usable on a phone', async ({ page }) => {
  await page.goto('login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('dark theme toggle applies', async ({ page }) => {
  await page.goto('./');
  const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!before);
});

test('the dock, launcher and quick actions work on a phone, and screens fit it', async ({ page }) => {
  test.skip(!accounts, 'Needs Supabase settings in .env.local');
  await login(page, accounts!.carol);
  const dock = page.getByRole('navigation', { name: 'Primary' });
  for (const [name, heading] of [['Groups', /Groups/], ['Balances', /Balances/], ['Friends', /Friends/], ['Home', /E2E Carol/]] as const) {
    if (name === 'Balances') {
      await dock.getByRole('button', { name: 'All', exact: true }).click();
      await page.getByRole('navigation', { name: 'All sections' }).getByRole('link', { name, exact: true }).click();
    } else {
      await dock.getByRole('link', { name, exact: true }).click();
    }
    await expect(page.locator('main h1').first()).toContainText(heading);
    await expect(pageContent(page)).toHaveCSS('opacity', '1');
    // Nothing may be wider than the phone (the page would slide sideways and taps would miss).
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // App-like: the screen itself never scrolls; only lists inside it do.
    expect(await page.evaluate(() => { const m = document.querySelector('main')!; return m.scrollHeight - m.clientHeight; })).toBeLessThanOrEqual(1);
  }
  for (const path of ['analytics', 'expenses', 'settings', 'pay']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Quick actions' }).click();
  await page.getByRole('navigation', { name: 'Quick actions' }).getByRole('link', { name: /^Add expense/ }).click();
  await expect(page.getByRole('heading', { name: 'Add an expense' })).toBeVisible();
  // Task screens hide the dock and keep their button on screen.
  await expect(dock).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add expense' })).toBeInViewport();
});
