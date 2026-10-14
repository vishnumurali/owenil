import { test, expect } from '@playwright/test';

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
