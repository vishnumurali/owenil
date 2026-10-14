import { minorUnitsOf } from './currency';

/**
 * Money is represented as an integer number of minor units (e.g. paise).
 * JavaScript numbers are exact for integers up to 2^53, so we cap any single
 * amount far below that and use BigInt for intermediate products.
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000; // 10 billion major units at 2dp

export interface Money {
  amountMinor: number;
  currency: string;
}

export function assertMinor(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of minor units`);
  }
}

/**
 * Parse a user-entered decimal string ("1,234.50", "3000", "0.5") into minor
 * units without going through floating point. Returns null when invalid or
 * when it has more decimal places than the currency allows.
 */
export function parseMoney(input: string, currency: string): number | null {
  const digits = minorUnitsOf(currency);
  const cleaned = input.trim().replace(/[,\s_]/g, '');
  if (cleaned === '') return null;
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, intPartRaw = '', fracRaw = ''] = match;
  if (intPartRaw === '' && fracRaw === '') return null;
  if (fracRaw.length > digits) {
    // Allow trailing zeros beyond precision ("10.500" for INR), reject real extra precision.
    if (!/^0*$/.test(fracRaw.slice(digits))) return null;
  }
  const frac = fracRaw.slice(0, digits).padEnd(digits, '0');
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  if (intPart.length > 15) return null;
  const value = Number(BigInt(intPart) * 10n ** BigInt(digits) + BigInt(frac === '' ? '0' : frac));
  if (!Number.isSafeInteger(value) || value > MAX_AMOUNT_MINOR) return null;
  return sign ? -value : value;
}

/** Minor units → plain decimal string ("123450" INR → "1234.50"). */
export function minorToDecimalString(amountMinor: number, currency: string): string {
  assertMinor(amountMinor);
  const digits = minorUnitsOf(currency);
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor).toString();
  if (digits === 0) return (negative ? '-' : '') + abs;
  const padded = abs.padStart(digits + 1, '0');
  const intPart = padded.slice(0, padded.length - digits);
  const fracPart = padded.slice(padded.length - digits);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

export interface FormatMoneyOptions {
  locale?: string;
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never';
  compact?: boolean;
  /** Hide the fraction when it is zero ("₹3,000" instead of "₹3,000.00"). */
  trimZeroFraction?: boolean;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string, opts: FormatMoneyOptions, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}|${opts.locale ?? ''}|${opts.signDisplay ?? ''}|${opts.compact ? 1 : 0}|${fractionDigits}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(opts.locale ?? 'en-IN', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      signDisplay: opts.signDisplay ?? 'auto',
      minimumFractionDigits: opts.compact ? 0 : fractionDigits,
      maximumFractionDigits: opts.compact ? 1 : fractionDigits,
      ...(opts.compact ? { notation: 'compact' as const } : {}),
    });
    formatterCache.set(key, f);
  }
  return f;
}

/**
 * Locale-aware currency formatting. Uses the decimal string so large values
 * never lose precision (Intl accepts numeric strings in modern runtimes; we
 * fall back to Number which is exact for our capped range).
 */
export function formatMoney(amountMinor: number, currency: string, opts: FormatMoneyOptions = {}): string {
  const digits = minorUnitsOf(currency);
  const isWhole = amountMinor % 10 ** digits === 0;
  const fractionDigits = opts.trimZeroFraction && isWhole ? 0 : digits;
  const f = getFormatter(currency, opts, fractionDigits);
  return f.format(Number(minorToDecimalString(amountMinor, currency)));
}

export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertMinor(v);
    total += v;
  }
  assertMinor(total, 'total');
  return total;
}

/**
 * Convert an amount using an exchange rate given as a decimal string
 * (1 unit of `from` = `rate` units of `to`). Rounds half away from zero to the
 * target currency's precision. Used only with explicit, user-recorded rate
 * snapshots — Owenil never claims rates are live.
 */
export function convertMinor(amountMinor: number, from: string, to: string, rate: string): number {
  assertMinor(amountMinor);
  if (from === to) return amountMinor;
  const m = /^(\d+)(?:\.(\d{1,12}))?$/.exec(rate.trim());
  if (!m) throw new Error('Exchange rate must be a positive decimal');
  const rateFrac = m[2] ?? '';
  const rateScaled = BigInt((m[1] ?? '0') + rateFrac);
  if (rateScaled === 0n) throw new Error('Exchange rate must be greater than zero');
  const fromDigits = minorUnitsOf(from);
  const toDigits = minorUnitsOf(to);
  // value_to_minor = amount_from_minor / 10^fromDigits * rate * 10^toDigits
  const numerator = BigInt(amountMinor) * rateScaled * 10n ** BigInt(toDigits);
  const denominator = 10n ** BigInt(rateFrac.length + fromDigits);
  const negative = numerator < 0n;
  const absNum = negative ? -numerator : numerator;
  let q = absNum / denominator;
  const r = absNum % denominator;
  if (r * 2n >= denominator) q += 1n;
  const result = Number(negative ? -q : q);
  assertMinor(result, 'converted amount');
  return result;
}
