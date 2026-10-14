import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForUpdate } from './lazy-page';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('isChunkLoadError', () => {
  it.each([
    new TypeError('Failed to fetch dynamically imported module: https://x/owenil/assets/GroupsPage-abc.js'),
    new TypeError('Importing a module script failed.'),
    new TypeError('error loading dynamically imported module'),
  ])('recognises %s', (e) => expect(isChunkLoadError(e)).toBe(true));

  it('ignores ordinary errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
});

describe('reloadOnceForUpdate', () => {
  it('reloads once, then refuses within a minute (no reload loops)', () => {
    const reload = vi.fn();
    expect(reloadOnceForUpdate(reload, 1_000_000)).toBe(true);
    expect(reloadOnceForUpdate(reload, 1_030_000)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // After a minute it may try again (e.g. a later deploy).
    expect(reloadOnceForUpdate(reload, 1_070_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when storage is unavailable (could not prevent a loop)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const reload = vi.fn();
    expect(reloadOnceForUpdate(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
