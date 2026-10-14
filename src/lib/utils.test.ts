import { describe, expect, it } from 'vitest';
import { safeNextPath } from './utils';

describe('safeNextPath (where to go after sign-in)', () => {
  it.each([
    '/dashboard',
    '/groups/3f2a1c9e-8b7d-4e6f-9a0b-1c2d3e4f5a6b',
    '/groups/3f2a1c9e-8b7d-4e6f-9a0b-1c2d3e4f5a6b?tab=balances',
    '/join/group/abc-DEF_123',
    '/expenses?q=goa%20trip',
  ])('keeps the in-app path %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    null,
    undefined,
    '',
    'dashboard',
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    '/\\/evil.example',
    '/groups\\..\\..\\evil',
    '/\tevil.example',
    '/\nevil.example',
    'javascript:alert(1)',
  ])('rejects %j', (bad) => {
    expect(safeNextPath(bad)).toBe('/dashboard');
    expect(safeNextPath(bad, '')).toBe('');
  });
});
