import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Simulated Android app + backend -------------------------------------------
const native = vi.hoisted(() => ({ android: true, pay: vi.fn() }));
vi.mock('@/lib/native-upi', async (orig) => {
  const real = await orig<typeof import('@/lib/native-upi')>();
  return { ...real, isAndroidApp: () => native.android, payWithUpiApp: native.pay };
});
const rpc = vi.hoisted(() => vi.fn(async () => ({ data: { settlement_ids: ['s1'] }, error: null })));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@/data/queries', () => ({
  useUpiId: () => ({ data: 'asha.k@okhdfcbank', isLoading: false }),
  useNameOf: () => () => 'Asha',
  invalidateFinancial: vi.fn(),
}));

const { PayDialog } = await import('./PayDialog');
const { UpiAppMissingError } = await import('@/lib/native-upi');

const request = {
  payeeId: 'asha', currency: 'INR', amountMinor: 120000, title: 'Pay Asha for “Villa”', upiNote: 'Owenil - Villa',
  build: (method: string) => [{ group_id: 'g1', payer_id: 'me', payee_id: 'asha', amount_minor: 120000, currency: 'INR', settled_on: '2026-10-14', method, note: 'For “Villa”', expense_id: 'e1' }],
} as never;

function open() {
  return render(<QueryClientProvider client={new QueryClient()}><PayDialog request={request} onClose={() => undefined} /></QueryClientProvider>);
}

beforeEach(() => {
  native.android = true;
  native.pay.mockReset();
  rpc.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('Android app: Pay with GPay', () => {
  it('opens Google Pay with the right payment link and marks it paid when Google Pay confirms', async () => {
    native.pay.mockResolvedValue({ status: 'success', reference: '428812345678', raw: '' });
    open();
    fireEvent.click(screen.getByRole('button', { name: /Pay with GPay/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(native.pay).toHaveBeenCalledWith(
      'upi://pay?pa=asha.k%40okhdfcbank&pn=Asha&am=1200.00&cu=INR&tn=Owenil%20-%20Villa',
      'com.google.android.apps.nbu.paisa.user',
    );
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, { p_payloads: { method: string; note: string; expense_id: string }[] }];
    expect(fn).toBe('record_settlements');
    expect(args.p_payloads[0]).toMatchObject({ method: 'upi', expense_id: 'e1', note: 'For “Villa” · UPI ref 428812345678' });
    expect(await screen.findByText('Marked as paid')).toBeTruthy();
    expect(screen.getByText(/Google Pay confirmed ₹1,200.00 to Asha \(UPI ref 428812345678\)/)).toBeTruthy();
  });

  it('records nothing when Google Pay reports a failure', async () => {
    native.pay.mockResolvedValue({ status: 'failure', reference: null, raw: '' });
    open();
    fireEvent.click(screen.getByRole('button', { name: /Pay with GPay/ }));
    expect(await screen.findByText(/didn't go through, so nothing was recorded/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('asks when there is no answer (e.g. the user backed out)', async () => {
    native.pay.mockResolvedValue({ status: 'unknown', reference: null, raw: null });
    open();
    fireEvent.click(screen.getByRole('button', { name: /Pay with GPay/ }));
    expect(await screen.findByText('Did your payment of ₹1,200.00 to Asha go through?')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('explains a pending payment and asks before marking it paid', async () => {
    native.pay.mockResolvedValue({ status: 'pending', reference: 'P1', raw: '' });
    open();
    fireEvent.click(screen.getByRole('button', { name: /Pay with GPay/ }));
    expect(await screen.findByText(/still processing/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('suggests another UPI app when Google Pay is not installed, and that one works', async () => {
    native.pay.mockRejectedValueOnce(new UpiAppMissingError('missing')).mockResolvedValueOnce({ status: 'success', reference: null, raw: '' });
    open();
    fireEvent.click(screen.getByRole('button', { name: /Pay with GPay/ }));
    expect(await screen.findByText(/Google Pay isn’t installed/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Other UPI app' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(native.pay).toHaveBeenLastCalledWith(expect.stringMatching(/^upi:\/\/pay\?/), undefined);
  });
});

describe('Browser', () => {
  it('never shows the Android-only GPay button', () => {
    native.android = false;
    open();
    expect(screen.queryByRole('button', { name: /Pay with GPay/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open UPI app' })).toBeTruthy();
  });
});
