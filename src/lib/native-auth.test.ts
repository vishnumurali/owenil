import { beforeEach, describe, expect, it, vi } from 'vitest';

const exchangeCodeForSession = vi.fn();
const browserClose = vi.fn(async () => {});
const listeners: Array<(e: { url: string }) => void> = [];
let launchUrl: string | undefined;
let android = true;

vi.mock('./supabase', () => ({ supabase: { auth: { exchangeCodeForSession } } }));
vi.mock('./native-upi', () => ({ isAndroidApp: () => android }));
vi.mock('./env', () => ({ appUrl: (p: string) => `https://vishnumurali.github.io/owenil/${p.replace(/^\//, '')}` }));
vi.mock('@capacitor/browser', () => ({ Browser: { close: browserClose, open: vi.fn() } }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, fn: (e: { url: string }) => void) => {
      listeners.push(fn);
      return { remove: vi.fn() };
    }),
    getLaunchUrl: vi.fn(async () => (launchUrl ? { url: launchUrl } : undefined)),
  },
}));

const { authRedirectUrl, completeAppLink, listenForAppLinks, parseAppLink } = await import('./native-auth');

beforeEach(() => {
  android = true;
  launchUrl = undefined;
  listeners.length = 0;
  sessionStorage.clear();
  exchangeCodeForSession.mockReset();
  browserClose.mockClear();
});

describe('authRedirectUrl', () => {
  it('returns to the app itself inside the Android app', () => {
    expect(authRedirectUrl('auth/callback?next=%2Fgroups')).toBe('io.github.vishnumurali.owenil://auth/callback?next=%2Fgroups');
    expect(authRedirectUrl('/reset-password')).toBe('io.github.vishnumurali.owenil://reset-password');
  });

  it('returns to the website in a browser', () => {
    android = false;
    expect(authRedirectUrl('reset-password')).toBe('https://vishnumurali.github.io/owenil/reset-password');
  });
});

describe('parseAppLink', () => {
  it('reads the route and the query and fragment parameters', () => {
    const link = parseAppLink('io.github.vishnumurali.owenil://auth/callback?code=abc&next=%2Fgroups%2F1#error_description=x');
    expect(link?.path).toBe('/auth/callback');
    expect(link?.params.get('code')).toBe('abc');
    expect(link?.params.get('next')).toBe('/groups/1');
    expect(link?.params.get('error_description')).toBe('x');
  });

  it('accepts a route without parameters or with a trailing slash', () => {
    expect(parseAppLink('io.github.vishnumurali.owenil://reset-password')?.path).toBe('/reset-password');
    expect(parseAppLink('io.github.vishnumurali.owenil://reset-password/?code=1')?.params.get('code')).toBe('1');
  });

  it('ignores other schemes and routes the app does not open from links', () => {
    expect(parseAppLink('https://vishnumurali.github.io/owenil/auth/callback?code=abc')).toBeNull();
    expect(parseAppLink('io.github.vishnumurali.owenil://settings/delete-account')).toBeNull();
    expect(parseAppLink('upi://pay?pa=x@upi')).toBeNull();
  });
});

describe('completeAppLink', () => {
  it('exchanges the code and continues to the callback page with the safe next route', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {}, redirectType: null }, error: null });
    const route = await completeAppLink(parseAppLink('io.github.vishnumurali.owenil://auth/callback?code=abc&next=%2Fpay')!);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(route).toBe('/auth/callback?next=%2Fpay');
  });

  it('opens the new-password form after a password-reset link', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {}, redirectType: 'PASSWORD_RECOVERY' }, error: null });
    expect(await completeAppLink(parseAppLink('io.github.vishnumurali.owenil://reset-password?code=r1')!)).toBe('/reset-password');
  });

  it('explains an expired or reused link instead of failing silently', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: null, user: null }, error: new Error('invalid flow state') });
    const route = await completeAppLink(parseAppLink('io.github.vishnumurali.owenil://auth/callback?code=old')!);
    expect(route).toMatch(/^\/auth\/callback\?error_description=/);
    expect(decodeURIComponent(route)).toContain('expired or was already used');
  });

  it('shows the error Supabase or Google reported (for example a cancelled sign-in)', async () => {
    const route = await completeAppLink(parseAppLink('io.github.vishnumurali.owenil://auth/callback#error=access_denied&error_description=User%20cancelled')!);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(route).toBe('/auth/callback?error_description=User%20cancelled');
  });
});

describe('listenForAppLinks', () => {
  it('handles a link that started the app and one that arrives later, each once', async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {}, user: {}, redirectType: null }, error: null });
    launchUrl = 'io.github.vishnumurali.owenil://auth/callback?code=first';
    const navigate = vi.fn();
    const stop = listenForAppLinks(navigate);
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/auth/callback'));
    expect(browserClose).toHaveBeenCalled();

    listeners[0]!({ url: 'io.github.vishnumurali.owenil://auth/callback?code=second' });
    await vi.waitFor(() => expect(exchangeCodeForSession).toHaveBeenCalledWith('second'));
    // The same link again (Android may deliver it twice, or the page reloaded): ignored.
    listeners[0]!({ url: 'io.github.vishnumurali.owenil://auth/callback?code=second' });
    listeners[0]!({ url: 'io.github.vishnumurali.owenil://auth/callback?code=first' });
    await new Promise((r) => setTimeout(r, 20));
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
    stop();
  });

  it('does nothing in a browser', () => {
    android = false;
    const navigate = vi.fn();
    listenForAppLinks(navigate)();
    expect(listeners).toHaveLength(0);
  });
});
