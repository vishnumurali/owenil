import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { formatMoney } from '@owenil/core';
import { cn, todayISO } from '@/lib/utils';
import { useNameOf } from '@/data/queries';
import { itemPayload, myItemDebts, type ItemDebt } from '@/data/payments';
import type { Expense } from '@/types/db';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { PayDialog, type PayRequest } from './PayDialog';
import { usePaymentContext } from './usePaymentContext';

type PayableExpense = Pick<Expense, 'id' | 'group_id' | 'currency' | 'deleted_at' | 'description' | 'expense_payers' | 'expense_splits'>;

/** The caller's debts on this expense with their current status (empty while loading or when nothing is owed). */
function useItemPay(expense: PayableExpense) {
  const ctx = usePaymentContext();
  const nameOf = useNameOf();
  const [request, setRequest] = React.useState<PayRequest | null>(null);
  const debts = React.useMemo(() => (ctx ? myItemDebts(expense, ctx) : []), [ctx, expense]);

  const open = (d: ItemDebt) => {
    if (!ctx) return;
    const me = ctx.me;
    const desc = expense.description;
    setRequest({
      payeeId: d.creditorId,
      currency: d.currency,
      amountMinor: d.payableMinor,
      title: `Pay ${nameOf(d.creditorId, { you: false })} for “${desc}”`,
      upiNote: `Owenil - ${desc}`,
      details:
        d.payableMinor < d.shareMinor ? (
          <p className="text-xs text-fg-muted">
            Your share was {formatMoney(d.shareMinor, d.currency)}; {formatMoney(d.shareMinor - d.payableMinor, d.currency)} of it is already covered.
          </p>
        ) : null,
      build: (method) => [itemPayload(d, me, { settledOn: todayISO(), method, note: `For “${desc}”`.slice(0, 500) })],
    });
  };
  return { debts, request, open, close: () => setRequest(null) };
}

/** Compact status for an expense row: "Pay ₹X" or "Paid" (nothing when you owe nothing or it's settled another way). */
export function ItemPayButton({ expense, className }: { expense: PayableExpense; className?: string }) {
  const { debts, request, open, close } = useItemPay(expense);
  if (debts.length === 0) return null;
  const due = debts.filter((d) => d.status === 'owe').sort((a, b) => b.payableMinor - a.payableMinor)[0];
  const allPaid = debts.every((d) => d.status === 'paid');
  if (!due && !allPaid) return null;
  return (
    <div className={cn('shrink-0', className)}>
      {due ? (
        <Button size="sm" variant="outline" onClick={() => open(due)} aria-label={`Pay ${formatMoney(due.payableMinor, due.currency)} for ${expense.description}`}>
          Pay {formatMoney(due.payableMinor, due.currency)}
        </Button>
      ) : (
        <Badge tone="positive"><CheckCircle2 /> Paid</Badge>
      )}
      <PayDialog request={request} onClose={close} />
    </div>
  );
}

/** The viewer's own debts on the expense page, each with a Pay button or a Paid/Settled badge. */
export function ItemPayStatus({ expense }: { expense: PayableExpense }) {
  const { debts, request, open, close } = useItemPay(expense);
  const nameOf = useNameOf();
  if (debts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {debts.map((d) =>
        d.status === 'owe' ? (
          <Button key={d.creditorId} size="sm" onClick={() => open(d)}>
            Pay {nameOf(d.creditorId, { you: false })} {formatMoney(d.payableMinor, d.currency)}
          </Button>
        ) : d.status === 'paid' ? (
          <Badge key={d.creditorId} tone="positive"><CheckCircle2 /> Paid {nameOf(d.creditorId, { you: false })}</Badge>
        ) : (
          <Badge key={d.creditorId}>Settled with {nameOf(d.creditorId, { you: false })}</Badge>
        ),
      )}
      <PayDialog request={request} onClose={close} />
    </div>
  );
}
