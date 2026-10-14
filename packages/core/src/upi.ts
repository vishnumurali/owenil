/**
 * UPI (India's Unified Payments Interface) helpers.
 *
 * Owenil never moves money. It builds a standard `upi://pay` link that opens
 * the payer's own UPI app (GPay, PhonePe, Paytm, BHIM…) with the payee, amount
 * and note filled in. The payer approves the payment in that app, then records
 * the repayment in Owenil. Free: no payment gateway, merchant account or fees.
 */
import { minorToDecimalString } from './money';

/** A UPI ID (VPA) such as `asha.k@okhdfcbank`: a handle, "@", then the bank/app suffix. */
export const UPI_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,98}@[a-z][a-z0-9]{1,63}$/;
export const UPI_ID_MAX_LENGTH = 100;

/** Usual per-payment cap for person-to-person UPI payments: ₹1,00,000 (in paise). */
export const UPI_P2P_LIMIT_MINOR = 10_000_000;

/** UPI IDs are case-insensitive; store and compare them trimmed and lower-case. */
export function normalizeUpiId(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUpiId(input: string): boolean {
  const v = normalizeUpiId(input);
  return v.length <= UPI_ID_MAX_LENGTH && UPI_ID_PATTERN.test(v);
}

/** Keeps text that every UPI app accepts: ASCII letters, digits, spaces and . , - ' & ( ) */
export function sanitizeUpiText(input: string, maxLength: number): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,'&()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .trim();
}

export interface UpiPaymentRequest {
  /** Payee's UPI ID. */
  upiId: string;
  /** Payee's name, shown by the UPI app for confirmation. */
  payeeName: string;
  /** Amount in paise. UPI supports INR only. */
  amountMinor: number;
  /** Short note shown in both people's payment history. */
  note?: string;
}

/**
 * Builds a `upi://pay` deep link in the NPCI format (pa, pn, am, cu, tn).
 * Person-to-person only: no merchant code or transaction reference.
 */
export function buildUpiUri({ upiId, payeeName, amountMinor, note }: UpiPaymentRequest): string {
  if (!isValidUpiId(upiId)) throw new Error('Invalid UPI ID');
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('UPI amount must be a positive number of paise');
  const params: [string, string][] = [
    ['pa', normalizeUpiId(upiId)],
    ['pn', sanitizeUpiText(payeeName, 50) || 'Owenil user'],
    ['am', minorToDecimalString(amountMinor, 'INR')],
    ['cu', 'INR'],
  ];
  const tn = note ? sanitizeUpiText(note, 50) : '';
  if (tn) params.push(['tn', tn]);
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}
