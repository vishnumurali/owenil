import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_KEY = 'owenil.reloaded-for-update';

/** True when a page's code file couldn't be fetched (typically: the site was redeployed). */
export function isChunkLoadError(error: unknown): boolean {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .* failed/i.test(msg);
}

/**
 * Reloads the page once to pick up a new deployment. Returns false (no reload)
 * if it already reloaded in the last minute or storage is unavailable, so a
 * genuinely broken file can never cause a reload loop.
 */
export function reloadOnceForUpdate(reload: () => void = () => window.location.reload(), now = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/**
 * React.lazy for route pages. After a deploy, an open tab may request page
 * files that no longer exist; instead of failing, reload once to get the new
 * version. Other errors reach the page's error boundary as usual.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await load();
    } catch (error) {
      if (isChunkLoadError(error) && reloadOnceForUpdate()) return new Promise<never>(() => {});
      throw error;
    }
  });
}
