import * as React from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info, Smartphone, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { buildUpiUri, formatMoney, UPI_P2P_LIMIT_MINOR, type SettlementPayload } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { newIdempotencyKey } from '@/lib/utils';
import { GPAY_PACKAGE, isAndroidApp, payWithUpiApp, UpiAppMissingError, type UpiOutcome } from '@/lib/native-upi';
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
 * Pay someone and mark it paid.
 * - Android app: "Pay with GPay" (or another UPI app) opens the payment natively;
 *   the UPI app reports the result, and a success is marked paid automatically.
 * - Browser: the UPI link / QR code; websites can't learn the result, so on
 *   return Owenil asks whether it went through.
 * Either way, marking paid records every repayment in one all-or-nothing call.
 */
export function PayDialog({ request, onClose }: { request: PayRequest | null; onClose: () => void }) {
  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && onClose()} title={request?.title ?? 'Pay'} description="Owenil never moves money: you pay in your own UPI or bank app, then it's marked paid here.">
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
  const androidApp = isAndroidApp();
  const [step, setStep] = React.useState<'pay' | 'confirm' | 'done'>('pay');
  const [awaitingReturn, setAwaitingReturn] = React.useState(false);
  const [method, setMethod] = React.useState<SettlementPayload['method']>('cash');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [doneText, setDoneText] = React.useState<string | null>(null);
  const idemKey = React.useMemo(() => newIdempotencyKey('pay'), []);
  const amountText = formatMoney(request.amountMinor, request.currency);

  // Browser: back from the UPI app, ask whether the payment went through.
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

  const markPaid = async (m: SettlementPayload['method'], extraNote?: string, done?: string) => {
    setError(null);
    setBusy(true);
    try {
      const payloads = request.build(m).map((p) => (extraNote ? { ...p, note: [p.note, extraNote].filter(Boolean).join(' · ').slice(0, 500) } : p));
      unwrap(await supabase.rpc('record_settlements', { p_payloads: payloads, p_idempotency_key: idemKey }));
      invalidateFinancial(qc);
      setDoneText(done ?? `${amountText} to ${name} is recorded and balances are updated.`);
      setStep('done');
      setTimeout(onDone, 2200);
    } catch (e) {
      setError(errorMessage(e));
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Android app: act on what Google Pay / the UPI app reported.
  const onNativeOutcome = (outcome: UpiOutcome, app: string) => {
    setNotice(null);
    if (outcome.status === 'success') {
      void markPaid('upi', outcome.reference ? `UPI ref ${outcome.reference}` : `Paid with ${app}`,
        `${app} confirmed ${amountText} to ${name}${outcome.reference ? ` (UPI ref ${outcome.reference})` : ''}. It's marked paid and balances are updated.`);
    } else if (outcome.status === 'failure') {
      setError(`${app} says the payment didn't go through, so nothing was recorded. Try again or use another UPI app.`);
    } else if (outcome.status === 'pending') {
      setNotice(`${app} says the payment is still processing. Mark it paid once it shows as successful.`);
      setStep('confirm');
    } else {
      setStep('confirm');
    }
  };

  if (step === 'done') {
    return (
      <div className="flex flex-col items-center py-8 text-center" role="status">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
          <CheckCircle2 className="size-16 text-positive" />
        </motion.div>
        <p className="mt-4 text-lg font-semibold">Marked as paid</p>
        <p className="mt-1 max-w-xs text-sm text-fg-muted">{doneText}</p>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-primary/30 bg-primary-soft/50 p-5 text-center">
          <p className="text-lg font-semibold">Did your payment of {amountText} to {name} go through?</p>
          <p className="mt-1 text-sm text-fg-muted">{notice ?? 'Check your UPI app shows it as successful before marking it paid.'}</p>
        </div>
        {error && <p role="alert" className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" loading={busy} onClick={() => void markPaid('upi')}>Yes, mark as paid</Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => { setNotice(null); setStep('pay'); }}>No, not yet</Button>
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
          {androidApp ? (
            <AndroidUpiPay upiId={upi.data} payeeName={name} amountMinor={request.amountMinor} note={request.upiNote} disabled={busy} onOutcome={onNativeOutcome} />
          ) : (
            <UpiPayPanel upiId={upi.data} payeeName={name} amountMinor={request.amountMinor} note={request.upiNote}
              onOpenApp={() => setAwaitingReturn(true)} hint="When it succeeds, mark it paid below." />
          )}
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

/**
 * Android app only: opens Google Pay directly with the payee's UPI ID and the
 * amount filled in (or lets the user pick another UPI app), then reports the
 * app's answer so a successful payment is marked paid without asking.
 */
function AndroidUpiPay({ upiId, payeeName, amountMinor, note, disabled, onOutcome }: {
  upiId: string;
  payeeName: string;
  amountMinor: number;
  note: string;
  disabled: boolean;
  onOutcome: (outcome: UpiOutcome, app: string) => void;
}) {
  const [busy, setBusy] = React.useState<'gpay' | 'any' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const uri = buildUpiUri({ upiId, payeeName, amountMinor, note });

  const run = async (which: 'gpay' | 'any') => {
    setError(null);
    setBusy(which);
    try {
      const outcome = await payWithUpiApp(uri, which === 'gpay' ? GPAY_PACKAGE : undefined);
      onOutcome(outcome, which === 'gpay' ? 'Google Pay' : 'Your UPI app');
    } catch (e) {
      if (e instanceof UpiAppMissingError) {
        setError(which === 'gpay' ? 'Google Pay isn’t installed on this phone. Use “Other UPI app” instead.' : 'No UPI app is installed on this phone.');
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="native-upi-title" className="rounded-2xl border border-primary/30 bg-primary-soft/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="native-upi-title" className="flex items-center gap-1.5 font-semibold"><Smartphone className="size-4 text-primary" /> Pay {payeeName} with UPI</p>
          <p className="mt-0.5 break-all text-xs text-fg-muted">{upiId}</p>
        </div>
        <span className="tabular shrink-0 font-semibold">{formatMoney(amountMinor, 'INR')}</span>
      </div>
      <Button size="lg" className="mt-3 w-full" loading={busy === 'gpay'} disabled={disabled || busy !== null} onClick={() => void run('gpay')}>
        <Wallet /> Pay with GPay
      </Button>
      <Button variant="outline" className="mt-2 w-full" loading={busy === 'any'} disabled={disabled || busy !== null} onClick={() => void run('any')}>
        Other UPI app
      </Button>
      <p className="mt-2 text-xs text-fg-muted">
        Google Pay opens with the UPI ID and amount filled in. Check the name before you pay. When Google Pay confirms it, Owenil marks it paid automatically.
      </p>
      {error && <p role="alert" className="mt-2 rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
      {amountMinor > UPI_P2P_LIMIT_MINOR && (
        <p className="mt-2 text-xs font-medium text-warning">UPI apps usually allow up to ₹1,00,000 per payment. Pay in parts and record each one.</p>
      )}
    </section>
  );
}
