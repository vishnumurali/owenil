import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, PartyPopper, Smartphone } from 'lucide-react';
import { formatMoney } from '@owenil/core';
import { useDocumentTitle } from '@/lib/hooks';
import { todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { useContacts, useGroups, useNameOf, useUpiId } from '@/data/queries';
import { paymentPlans, planPayloads, type PersonPlan } from '@/data/payments';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, FitBody, FitScreen, PageHeader } from '@/components/ui/layout-bits';
import { PayDialog, type PayRequest } from './PayDialog';
import { usePaymentContext } from './usePaymentContext';

/**
 * Everything the user owes each person, combined across groups and friends,
 * paid in one go. Marking it paid records one repayment per group in a single
 * all-or-nothing call, so every balance with that person ends at zero.
 */
export default function PayPage() {
  useDocumentTitle('Pay');
  const { user } = useAuth();
  const ctx = usePaymentContext();
  const contacts = useContacts();
  const groups = useGroups();
  const nameOf = useNameOf();
  const myUpi = useUpiId(user?.id);
  const [request, setRequest] = React.useState<PayRequest | null>(null);
  const plans = React.useMemo(() => (ctx ? paymentPlans(ctx.edges, ctx.me) : []), [ctx]);
  const where = (groupId: string | null) => (groupId ? groups.data?.find((g) => g.id === groupId)?.name ?? 'A group' : 'Between friends');

  const payAll = (plan: PersonPlan) => {
    if (!ctx) return;
    const name = nameOf(plan.personId, { you: false });
    setRequest({
      payeeId: plan.personId,
      currency: plan.currency,
      amountMinor: plan.totalMinor,
      title: `Pay ${name} everything you owe`,
      upiNote: 'Owenil - settle up',
      details: <Breakdown plan={plan} where={where} />,
      build: (method) => planPayloads(plan, ctx.me, { settledOn: todayISO(), method, note: 'Combined payment' }),
    });
  };

  return (
    <FitScreen className="mx-auto w-full max-w-3xl">
      <PageHeader title="Pay" description="Everything you owe each person, combined across groups. Pay it in one go and Owenil records it everywhere." />
      <FitBody className="space-y-6">

      {!ctx ? (
        <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : plans.length === 0 ? (
        <Card>
          <EmptyState
            illustration="balanced"
            title="You don’t owe anyone"
            description="When you owe someone, they’ll appear here with one button to pay everything."
            action={<Button asChild variant="outline"><Link to="/balances">See all balances</Link></Button>}
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => {
            const p = contacts.data?.get(plan.personId);
            return (
              <Card key={`${plan.personId}|${plan.currency}`} className="p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{nameOf(plan.personId, { you: false })}</p>
                    <p className="text-xs text-fg-muted">{plan.parts.length === 1 ? where(plan.parts[0]!.groupId) : `${plan.parts.length} balances combined`}</p>
                  </div>
                  <p className="tabular font-display text-xl font-semibold text-negative">{formatMoney(plan.totalMinor, plan.currency)}</p>
                </div>
                {plan.parts.length > 1 && <div className="mt-3"><Breakdown plan={plan} where={where} /></div>}
                <Button className="mt-4 w-full" onClick={() => payAll(plan)}>
                  Pay {formatMoney(plan.totalMinor, plan.currency)} <ArrowRight />
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      {myUpi.data === null && (
        <Card className="flex items-center gap-3 p-4 text-sm">
          <Smartphone className="size-5 shrink-0 text-primary" />
          <p className="flex-1 text-fg-muted">Add your UPI ID so friends can pay you back in one tap too.</p>
          <Button asChild size="sm" variant="outline"><Link to="/settings#upi">Add UPI ID</Link></Button>
        </Card>
      )}
      {ctx && plans.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-fg-subtle">
          <PartyPopper className="mt-0.5 size-3.5 shrink-0" />
          If someone also owes you in another group, that amount is subtracted, so you only pay the difference.
        </p>
      )}
      </FitBody>
      <PayDialog request={request} onClose={() => setRequest(null)} />
    </FitScreen>
  );
}

function Breakdown({ plan, where }: { plan: PersonPlan; where: (g: string | null) => string }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border text-sm">
      {plan.parts.map((part) => (
        <li key={part.groupId ?? 'friends'} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="min-w-0 truncate">{where(part.groupId)}</span>
          {part.iOweMinor > 0 ? (
            <span className="tabular shrink-0">you owe {formatMoney(part.iOweMinor, plan.currency)}</span>
          ) : (
            <span className="tabular shrink-0 text-positive">− they owe you {formatMoney(part.theyOweMinor, plan.currency)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
