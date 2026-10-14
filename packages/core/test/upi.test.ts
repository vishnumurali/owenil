import { describe, expect, it } from 'vitest';
import { buildUpiUri, isValidUpiId, normalizeUpiId, sanitizeUpiText, UPI_P2P_LIMIT_MINOR } from '../src';

describe('UPI IDs', () => {
  it.each(['asha.k@okhdfcbank', 'ravi_99@ybl', '9876543210@paytm', 'meera-s@oksbi', 'a1@upi', 'ASHA.K@OKAXIS'])('accepts %s', (id) => {
    expect(isValidUpiId(id)).toBe(true);
  });

  it.each(['', 'asha', '@okhdfc', 'asha@', 'a@b', 'asha k@ybl', 'asha@ybl.com', 'asha@@ybl', '.asha@ybl', 'asha@9bank', `${'a'.repeat(99)}@ybl`])(
    'rejects %j',
    (id) => {
      expect(isValidUpiId(id)).toBe(false);
    },
  );

  it('normalizes case and whitespace', () => {
    expect(normalizeUpiId('  Asha.K@OkHdfcBank ')).toBe('asha.k@okhdfcbank');
  });
});

describe('UPI text', () => {
  it('keeps only characters every UPI app accepts', () => {
    expect(sanitizeUpiText('Goa 🏖️ trip — “villa”', 50)).toBe('Goa trip villa');
    expect(sanitizeUpiText('Zoë & Ana (flat 4B)', 50)).toBe('Zoe & Ana (flat 4B)');
  });

  it('truncates without trailing spaces', () => {
    expect(sanitizeUpiText('Owenil settle up for the long weekend trip', 12)).toBe('Owenil settl');
    expect(sanitizeUpiText('Owenil settle', 7)).toBe('Owenil');
  });
});

describe('buildUpiUri', () => {
  it('builds an NPCI person-to-person payment link', () => {
    expect(buildUpiUri({ upiId: 'Asha.K@okhdfcbank', payeeName: 'Asha K', amountMinor: 123450, note: 'Owenil - Goa trip' })).toBe(
      'upi://pay?pa=asha.k%40okhdfcbank&pn=Asha%20K&am=1234.50&cu=INR&tn=Owenil%20-%20Goa%20trip',
    );
  });

  it('always sends two decimal places and no merchant fields', () => {
    const uri = buildUpiUri({ upiId: 'ravi@ybl', payeeName: 'Ravi', amountMinor: 100000 });
    expect(uri).toContain('am=1000.00');
    expect(uri).not.toMatch(/[?&](mc|tr|tid)=/);
    expect(uri).not.toContain('tn=');
  });

  it('falls back to a generic name when nothing printable is left', () => {
    expect(buildUpiUri({ upiId: 'ravi@ybl', payeeName: '🙂', amountMinor: 1 })).toContain('pn=Owenil%20user');
  });

  it('rejects invalid IDs and amounts', () => {
    expect(() => buildUpiUri({ upiId: 'not-an-id', payeeName: 'X', amountMinor: 100 })).toThrow(/UPI ID/);
    expect(() => buildUpiUri({ upiId: 'ravi@ybl', payeeName: 'X', amountMinor: 0 })).toThrow(/positive/);
    expect(() => buildUpiUri({ upiId: 'ravi@ybl', payeeName: 'X', amountMinor: 10.5 })).toThrow(/positive/);
  });

  it('exposes the usual ₹1,00,000 person-to-person cap', () => {
    expect(UPI_P2P_LIMIT_MINOR).toBe(100_000 * 100);
  });
});
