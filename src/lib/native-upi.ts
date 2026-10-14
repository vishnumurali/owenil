import { Capacitor, registerPlugin } from '@capacitor/core';
import { env } from './env';

/** Google Pay (India) on Android. */
export const GPAY_PACKAGE = 'com.google.android.apps.nbu.paisa.user';

interface UpiPlugin {
  canPay(options: { package?: string }): Promise<{ available: boolean }>;
  pay(options: { uri: string; package?: string }): Promise<{ resultCode: number; response: string | null }>;
}

/** Native code in android/app/src/main/java/.../UpiPlugin.java. */
const Upi = registerPlugin<UpiPlugin>('Upi');

/** True only inside the Owenil Android app (never in a browser). */
export function isAndroidApp(): boolean {
  return env.platform === 'android' && Capacitor.getPlatform() === 'android';
}

export interface UpiOutcome {
  /** success / failure as reported by the UPI app; pending = submitted but not final; unknown = no answer. */
  status: 'success' | 'failure' | 'pending' | 'unknown';
  /** Bank / UPI reference to quote if anything goes wrong. */
  reference: string | null;
  raw: string | null;
}

/**
 * Reads a UPI app's reply, e.g. "txnId=AB12&responseCode=00&Status=SUCCESS&txnRef=XYZ&ApprovalRefNo=123".
 * Key names vary by app, so matching ignores case.
 */
export function parseUpiResponse(raw: string | null | undefined): UpiOutcome {
  if (!raw) return { status: 'unknown', reference: null, raw: null };
  const fields = new Map<string, string>();
  for (const part of raw.split('&')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    let value = part.slice(i + 1);
    try {
      value = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      /* keep as is */
    }
    fields.set(part.slice(0, i).trim().toLowerCase(), value.trim());
  }
  const s = (fields.get('status') ?? '').toUpperCase();
  const status: UpiOutcome['status'] =
    s === 'SUCCESS' ? 'success' : s === 'FAILURE' || s === 'FAILED' ? 'failure' : s === 'SUBMITTED' || s === 'PENDING' ? 'pending' : 'unknown';
  const reference = fields.get('approvalrefno') || fields.get('txnref') || fields.get('txnid') || null;
  return { status, reference, raw };
}

/** Whether Google Pay (or, without a package, any UPI app) is installed. */
export async function canPayWith(pkg?: string): Promise<boolean> {
  if (!isAndroidApp()) return false;
  try {
    return (await Upi.canPay({ package: pkg })).available;
  } catch {
    return false;
  }
}

export class UpiAppMissingError extends Error {}

/** Opens the payment in Google Pay (or a UPI app chooser) and returns what the app reported. */
export async function payWithUpiApp(uri: string, pkg?: string): Promise<UpiOutcome> {
  try {
    const r = await Upi.pay({ uri, package: pkg });
    return parseUpiResponse(r.response);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'APP_NOT_FOUND') throw new UpiAppMissingError((e as Error).message);
    throw e;
  }
}
