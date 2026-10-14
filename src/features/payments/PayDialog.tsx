import * as React from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney, type SettlementPayload } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { newIdempotencyKey } from '@/lib/utils';
import { invalidateFinancial, useNameOf, useUpiId } from '@/data/queries';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, NativeSelect } from '@/components/ui/input';
import { UpiPayPanel } from './UpiPayPanel';

export interface PayRequest {
  payeeId: string;
  currency: string;
  /** What is being paid now. */
  amountMinor: number;
  title: string;
  /** Note shown in both people's UPI history (kept short). */
  upiNote: string;
  /** Optional explanation (e.g. which groups a combined payment covers). */
  details?: React.ReactNode;
  /** The repayments to record once paid, for the chosen method. */
  build: (method: SettlementPayload['method']) => SettlementPayload[];
}

const OTHER_METHODS = [
  { v: 'cash', label: 'Cash' },
  { v: 'bank_transfer', label: 'Bank transfer' },
  { v: 'upi', label: 'UPI (another way)' },
  { v: 'card', label: 'Card' },
  { v: 'other', label: 'Other' },
] as const;

/**
 * Pay someone and mark it paid. With a UPI ID (INR), the payer's UPI app opens
 * with everything filled in, or a QR code is shown. Websites can't learn the
 * outcome of a UPI payment, so when the person comes back Owenil asks whether it
 * went through, and "Yes" records every repayment in one all-or-nothing call.
 */
export function PayDialog({ request, onClose }: { request: PayRequest | null; onClose: () => void }) {
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()} title={request?.title ?? 'Pay'} description="Owenil never moves money: you pay in your own UPI or bank app, then mark it paid here.">
      {request && <PayFlow key={`${request.payeeId}|${request.amountMinor}|${request.title}`} request={request} onDone={onClose} />}
    </Dialog>
  );
}

function PayFlow({ request, onDone }: { request: PayRequest; onDone: () => void }) {
  const qc = useQueryClient();
  const nameOf = useNameOf();
  const name = nameOf(request.payeeId, { you: false });
  const inr = request.currency === 'INR';
  const upi = useUpiId(inr ? request.payeeId : null);
  const [step, setStep] = React.useState<'pay' | 'confirm' | 'done'>('pay');
  const [awaitingReturn, setAwaitingReturn] = React.useState(false);
  const [method, setMethod] = React.useState<SettlementPayload['method']>('cash');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const idemKey = React.useMemo(() => newIdempotencyKey('pay'), []);
  const amountText = formatMoney(request.amountMinor, request.currency);

  // Back from the UPI app: ask whether the payment went through.
  React.useEffect(() => {
    if (!awaitingReturn) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setAwaitingReturn(false);
        setStep('confirm');
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [awaitingReturn]);

  const markPaid = async (m: SettlementPayload['method']) => {
    setError(null);
    setBusy(true);
    try {
      unwrap(await supabase.rpc('record_settlements', { p_payloads: request.build(m), p_idempotency_key: idemKey }));
      invalidateFinancial(qc);
      setStep('done');
      setTimeout(onDone, 1600);
    } catch (e) {
      setError(errorMessage(e));
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <div className="flex flex-col items-center py-8 text-center" role="status">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
          <CheckCircle2 className="size-16 text-positive" />
        </motion.div>
        <p className="mt-4 text-lg font-semibold">Marked as paid</p>
        <p className="mt-1 max-w-xs text-sm text-fg-muted">{amountText} to {name} is recorded and balances are updated.</p>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-primary/30 bg-primary-soft/50 p-5 text-center">
          <p className="text-lg font-semibold">Did your payment of {amountText} to {name} go through?</p>
          <p className="mt-1 text-sm text-fg-muted">Check your UPI app shows it as successful before marking it paid.</p>
        </div>
        {error && <p role="alert" className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" loading={busy} onClick={() => void markPaid('upi')}>Yes, mark as paid</Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => setStep('pay')}>No, not yet</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-fg-muted">Amount to pay {name}</p>
        <p className="tabular font-display text-2xl font-semibold">{amountText}</p>
      </div>
      {request.details}
      {inr && upi.data ? (
        <>
          <UpiPayPanel upiId={upi.data} payeeName={name} amountMinor={request.amountMinor} note={request.upiNote}
            onOpenApp={() => setAwaitingReturn(true)} hint="When it succeeds, mark it paid below." />
          {error && <p role="alert" className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
          <Button size="lg" variant="outline" className="w-full" loading={busy} onClick={() => setStep('confirm')}>I’ve paid — mark as paid</Button>
        </>
      ) : (
        <>
          <p className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-sm text-accent">
            <Info className="mt-0.5 size-4 shrink-0" />
            {!inr
              ? 'UPI works only for rupees. Pay another way, then mark it paid.'
              : upi.isLoading
                ? 'Checking for a UPI ID…'
                : `${name} hasn’t added a UPI ID yet, so pay another way and mark it paid. They can add one in Settings.`}
          </p>
          <Field label="How did you pay?" htmlFor="pay-method">
            <NativeSelect id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as SettlementPayload['method'])}>
              {OTHER_METHODS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
            </NativeSelect>
          </Field>
          {error && <p role="alert" className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
          <Button size="lg" className="w-full" loading={busy} onClick={() => void markPaid(method)}>Mark as paid</Button>
        </>
      )}
    </div>
  );
}
