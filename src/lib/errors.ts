/**
 * Database functions raise errors with a human-readable message and a stable
 * code in HINT. This turns any thrown value into something safe to display.
 */
export interface AppError {
  code: string;
  message: string;
}

const FRIENDLY: Record<string, string> = {
  '23505': 'That already exists.',
  '42501': 'You don’t have permission to do that.',
  PGRST301: 'Your session expired. Please sign in again.',
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Please confirm your email address first — check your inbox.',
  over_email_send_rate_limit: 'Too many emails were requested. Please wait a few minutes and try again.',
  user_already_exists: 'An account with this email already exists. Try signing in.',
  weak_password: 'Choose a stronger password.',
};

export function toAppError(e: unknown): AppError {
  if (e && typeof e === 'object') {
    const anyE = e as { code?: string; hint?: string; message?: string; status?: number; name?: string };
    if (anyE.hint && /^[A-Z_]+$/.test(anyE.hint)) return { code: anyE.hint, message: anyE.message ?? 'Something went wrong.' };
    if (anyE.code && FRIENDLY[anyE.code]) return { code: anyE.code, message: FRIENDLY[anyE.code]! };
    if (anyE.message === 'Failed to fetch' || anyE.name === 'TypeError') {
      return { code: 'NETWORK', message: 'Can’t reach the server. Check your connection and try again.' };
    }
    if (anyE.message) return { code: anyE.code ?? 'ERROR', message: anyE.message };
  }
  return { code: 'ERROR', message: 'Something went wrong. Please try again.' };
}

export function errorMessage(e: unknown): string {
  return toAppError(e).message;
}

/** Throws Supabase errors so React Query sees them. */
export function unwrap<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}
