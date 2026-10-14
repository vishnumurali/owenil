/**
 * Currency metadata. `minorUnits` is the ISO-4217 exponent: the number of
 * decimal places used by the currency. All money in Owenil is stored as an
 * integer count of minor units (paise, cents, yen...) to avoid floating-point
 * errors. The same list is seeded into the `currencies` table.
 */
export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  minorUnits: 0 | 2 | 3;
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', minorUnits: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', minorUnits: 2 },
  { code: 'GBP', name: 'British Pound', symbol: '£', minorUnits: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', minorUnits: 2 },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', minorUnits: 2 },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', minorUnits: 2 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', minorUnits: 2 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', minorUnits: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', minorUnits: 2 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', minorUnits: 2 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', minorUnits: 2 },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr', minorUnits: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', minorUnits: 2 },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', minorUnits: 2 },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', minorUnits: 2 },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', minorUnits: 2 },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'रू', minorUnits: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', minorUnits: 2 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', minorUnits: 0 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', minorUnits: 0 },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', minorUnits: 2 },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', minorUnits: 0 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD', minorUnits: 3 },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BD', minorUnits: 3 },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR', minorUnits: 3 },
] as const;

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

export function getCurrency(code: string): CurrencyInfo {
  const c = BY_CODE.get(code);
  if (!c) throw new Error(`Unsupported currency: ${code}`);
  return c;
}

export function minorUnitsOf(code: string): number {
  return getCurrency(code).minorUnits;
}
