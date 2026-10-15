import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { appUrl } from './env';
import { isNativeApp } from './native-upi';
import { supabase } from './supabase';

/**
 * The phone apps' private link scheme (reverse domain name, as RFC 8252
 * recommends for native apps). Google sign-in and auth emails that start in
 * an app come back to io.github.vishnumurali.owenil://…, and Android or iOS
 * opens the app. The Supabase redirect allow-list includes it.
 */
export const APP_LINK_SCHEME = 'io.github.vishnumurali.owenil';

/** Routes an app link may open. Anything else is ignored. */
const APP_LINK_ROUTES = new Set(['/auth/callback', '/reset-password']);

/**
 * Where Google sign-in and auth emails return to. In the phone apps that is
 * the app itself, because the PKCE code verifier is stored there; on the
 * website it is the website.
 */
export function authRedirectUrl(path: string): string {
  const clean = path.replace(/^\//, '');
  return isNativeApp() ? `${APP_LINK_SCHEME}://${clean}` : appUrl(clean);
}

export interface AppLink {
  /** In-app route, e.g. "/auth/callback". */
  path: string;
  /** Query and fragment parameters together (Supabase reports errors in either). */
  params: URLSearchParams;
}

/**
 * Reads "io.github.vishnumurali.owenil://auth/callback?code=…" by hand: older
 * Android WebViews don't parse the host of custom-scheme URLs.
 */
export function parseAppLink(url: string): AppLink | null {
  const prefix = `${APP_LINK_SCHEME}://`;
  if (!url.toLowerCase().startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const cut = rest.search(/[?#]/);
  const path = `/${(cut === -1 ? rest : rest.slice(0, cut)).replace(/^\/+|\/+$/g, '')}`;
  if (!APP_LINK_ROUTES.has(path)) return null;
  const params = new URLSearchParams();
  if (cut !== -1) {
    const tail = rest.slice(cut);
    const hashAt = tail.indexOf('#');
    const query = hashAt === -1 ? tail : tail.slice(0, hashAt);
    const fragment = hashAt === -1 ? '' : tail.slice(hashAt + 1);
    for (const part of [query.replace(/^\?/, ''), fragment]) {
      new URLSearchParams(part).forEach((value, key) => {
        if (!params.has(key)) params.set(key, value);
      });
    }
  }
  return { path, params };
}

const EXPIRED = 'This link has expired or was already used. Sign in, or ask for a new link.';

/**
 * Finishes the sign-in or password reset an app link carries (exchanges the
 * one-time code for a session) and returns the route to show next.
 */
export async function completeAppLink(link: AppLink): Promise<string> {
  const problem = link.params.get('error_description') ?? link.params.get('error');
  if (problem) return `/auth/callback?error_description=${encodeURIComponent(problem)}`;
  const code = link.params.get('code');
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return `/auth/callback?error_description=${encodeURIComponent(EXPIRED)}`;
    // auth-js reports how the code was requested (not in its public types).
    if ((data as { redirectType?: string | null }).redirectType === 'PASSWORD_RECOVERY') return '/reset-password';
  }
  if (link.path === '/reset-password') return '/reset-password';
  const next = link.params.get('next');
  return `/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
}

const HANDLED_KEY = 'owenil.handledAppLinks';

/** Each link's one-time code works once, so a link is never handled twice (even after a reload). */
function firstTime(url: string): boolean {
  try {
    const seen: string[] = JSON.parse(sessionStorage.getItem(HANDLED_KEY) ?? '[]');
    if (seen.includes(url)) return false;
    sessionStorage.setItem(HANDLED_KEY, JSON.stringify([...seen.slice(-19), url]));
  } catch {
    /* storage unavailable: handle it anyway */
  }
  return true;
}

/**
 * Listens for app links in the phone apps: both a link that started the app
 * and one that arrives while it runs. Calls navigate with the route to show.
 * Returns a function that stops listening.
 */
export function listenForAppLinks(navigate: (route: string) => void): () => void {
  if (!isNativeApp()) return () => {};
  let active = true;
  const handle = async (url: string | undefined) => {
    if (!url) return;
    const link = parseAppLink(url);
    if (!link || !firstTime(url)) return;
    void Browser.close().catch(() => {}); // the Google sign-in tab, if it is still open
    const route = await completeAppLink(link);
    if (active) navigate(route);
  };
  const listener = App.addListener('appUrlOpen', (event) => void handle(event.url));
  void App.getLaunchUrl()
    .then((launch) => handle(launch?.url))
    .catch(() => {});
  return () => {
    active = false;
    void listener.then((l) => l.remove());
  };
}

/** Opens Google's sign-in page in the system browser tab (Chrome on Android, Safari on iPhone); Google blocks sign-in inside app web views. */
export async function openSignInPage(url: string): Promise<void> {
  await Browser.open({ url });
}
