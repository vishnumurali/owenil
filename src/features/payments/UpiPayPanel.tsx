import * as React from 'react';
import { QrCode as QrIcon, Smartphone } from 'lucide-react';
import { buildUpiUri, formatMoney, UPI_P2P_LIMIT_MINOR } from '@owenil/core';
import { Button } from '@/components/ui/button';
import { QrCode } from '@/components/ui/qr-code';

function useCoarsePointer(): boolean {
  return React.useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches, []);
}

/**
 * Opens the payer's own UPI app with everything filled in (on a phone), or shows
 * a QR code to scan with it (on a computer). Owenil never sees the payment, so
 * the person confirms it afterwards.
 */
export function UpiPayPanel({
  upiId, payeeName, amountMinor, note, onOpenApp, hint = 'When the payment succeeds, record it below.',
}: {
  upiId: string;
  payeeName: string;
  amountMinor: number | null;
  note: string;
  /** Called when the person taps "Open UPI app" (e.g. to ask "did it go through?" on return). */
  onOpenApp?: () => void;
  hint?: string;
}) {
  const touch = useCoarsePointer();
  const [showQr, setShowQr] = React.useState(!touch);
  if (!amountMinor || amountMinor <= 0) {
    return (
      <p className="rounded-xl border border-dashed border-fg/15 p-3 text-sm text-fg-muted">
        Enter an amount to pay {payeeName} with UPI.
      </p>
    );
  }
  const uri = buildUpiUri({ upiId, payeeName, amountMinor, note });
  const amountText = formatMoney(amountMinor, 'INR');
  return (
    <section aria-labelledby="upi-pay-title" className="rounded-2xl border border-primary/30 bg-primary-soft/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="upi-pay-title" className="flex items-center gap-1.5 font-semibold"><Smartphone className="size-4 text-primary" /> Pay {payeeName} with UPI</p>
          <p className="mt-0.5 break-all text-xs text-fg-muted">{upiId}</p>
        </div>
        <span className="tabular shrink-0 font-semibold">{amountText}</span>
      </div>
      <div className="mt-3 flex flex-col items-center gap-3 sm:flex-row sm:items-center">
        {showQr && <QrCode value={uri} label={`UPI QR code to pay ${payeeName} ${amountText}`} className="size-40 shrink-0 border border-border" />}
        <div className="w-full flex-1 space-y-2">
          <Button asChild className="w-full">
            <a href={uri} onClick={() => onOpenApp?.()}>Open UPI app</a>
          </Button>
          {!showQr && (
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => setShowQr(true)}>
              <QrIcon /> Show QR code
            </Button>
          )}
          <p className="text-xs text-fg-muted">
            {showQr ? 'Scan with GPay, PhonePe, Paytm or any UPI app, or tap the button on your phone. ' : ''}
            Check the name in your UPI app before paying. {hint}
          </p>
        </div>
      </div>
      {amountMinor > UPI_P2P_LIMIT_MINOR && (
        <p className="mt-3 text-xs font-medium text-warning">
          UPI apps usually allow up to ₹1,00,000 per payment. Pay in parts and record each one.
        </p>
      )}
    </section>
  );
}
