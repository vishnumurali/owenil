import { existsSync, readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export interface Account {
  email: string;
  password: string;
  name: string;
  id: string;
}

export function loadAccounts(): Record<'alice' | 'bob' | 'carol' | 'xena', Account> | null {
  if (!existsSync('e2e-credentials.local.json')) return null;
  const c = JSON.parse(readFileSync('e2e-credentials.local.json', 'utf8')) as { configured: boolean; accounts?: Record<string, Account> };
  return c.configured ? (c.accounts as Record<'alice' | 'bob' | 'carol' | 'xena', Account>) : null;
}

export async function login(page: Page, a: Account) {
  await page.goto('login');
  await page.getByLabel('Email').fill(a.email);
  await page.getByLabel('Password', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}
