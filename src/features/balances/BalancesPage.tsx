import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, HandCoins, Info, Sparkles } from 'lucide-react';
import { formatMoney } from '@owenil/core';
import { useDocumentTitle } from '@/lib/hooks';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBalanceOverview, useContacts, useGroups, useNameOf } from '@/data/queries';
import { byCounterparty, deriveMyEdges, totalsByCurrency, type Edge } from '@/data/balances';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { AnimatedMoney } from '@/components/ui/money';
import { Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { EmptyState, ErrorState, PageHeader, SectionTitle, Stagger, StaggerItem } from '@/components/ui/layout-bits';
import { GroupBadge } from '@/components/domain';
import { SettleUpDialog, type SettleDefaults } from './SettleUpDialog';

export default function BalancesPage() {
  useDocumentTitle('Balances');
  const { user } = useAuth();
  const me = user!.id;
  const balances = useBalanceOverview();
  const groups = useGroups();
  const contacts = useContacts();
  const nameOf = useNameOf();
  const [view, setView] = React.useState<'people' | 'groups'>('people');
  const [settle, setSettle] = React.useState<SettleDefaults | null>(null);

  const edges = React.useMemo(() => (balances.data && groups.data ? deriveMyEdges(balances.data, groups.data, me) : []), [balances.data, groups.data, me]);
  const totals = totalsByCurrency(edges, me);
  const people = byCounterparty(edges, me);
  const byGroup = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = e.groupId ?? 'none';
    byGroup.set(k, [...(byGroup.get(k) ?? []), e]);
  }

  if (balances.isError) return <ErrorState error={balances.error} onRetry={() => balances.refetch()} />;

  return (
    <div>
      <PageHeader
        title="Balances"
        description="Who owes whom, per currency. Amounts in different currencies are never added together."
        actions={<Button variant="outline" onClick={() => setSettle({})}><HandCoins /> Record a repayment</Button>}
      />

      {balances.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : totals.length === 0 ? (
        <Card>
          <EmptyState illustration="balanced" title="You’re all settled up" description="When you share expenses, balances appear here with suggested repayments." action={<Button asChild><Link to="/expenses/new">Add an expense</Link></Button>} />
        </Card>
      ) : (
        <>
          <Stagger className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {totals.map((t) => (
              <StaggerItem key={t.currency}>
                <Card className="p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{t.currency}</p>
                  <AnimatedMoney amountMinor={t.net} currency={t.currency} tone="auto" signDisplay="exceptZero" className="mt-1 block font-display text-3xl font-semibold" />
                  <div className="mt-3 flex gap-4 text-sm">
                    <span className="text-positive">Owed to you <strong className="tabular">{formatMoney(t.owedToMe, t.currency)}</strong></span>
                    <span className="text-negative">You owe <strong className="tabular">{formatMoney(t.iOwe, t.currency)}</strong></span>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>

          <Segmented className="mb-4" value={view} onChange={setView} ariaLabel="Group balances by" options={[{ value: 'people', label: 'By person' }, { value: 'groups', label: 'By group' }]} />

          {view === 'people' ? (
            <Card className="divide-y divide-border">
              {[...people.entries()].map(([uid, m]) => {
                const p = contacts.data?.get(uid);
                const personEdges = edges.filter((e) => e.fromId === uid || e.toId === uid);
                return (
                  <div key={uid} className="p-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} />
                      <Link to={`/friends/${uid}`} className="min-w-0 flex-1 font-medium hover:underline">{nameOf(uid)}</Link>
                      <div className="text-right">
                        {[...m.entries()].map(([c, v]) => (
                          <p key={c} className={`text-sm ${v > 0 ? 'text-positive' : 'text-negative'}`}>
                            {v > 0 ? 'owes you ' : 'you owe '}<strong className="tabular">{formatMoney(Math.abs(v), c)}</strong>
                          </p>
                        ))}
                      </div>
                    </div>
                    <div className="mt-3 space-y-1.5 pl-[52px]">
                      {personEdges.map((e, i) => {
                        const g = groups.data?.find((x) => x.id === e.groupId);
                        return (
                          <div key={i} className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                            <span className="min-w-0 flex-1 truncate">{g ? `${g.emoji} ${g.name}` : 'Non-group'}{g?.simplify_debts ? ' · simplified' : ''}</span>
                            <span className="tabular">{nameOf(e.fromId)} → {nameOf(e.toId)} {formatMoney(e.amountMinor, e.currency)}</span>
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setSettle({ groupId: e.groupId, payerId: e.fromId, payeeId: e.toId, amountMinor: e.amountMinor, currency: e.currency })}>Settle</Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </Card>
          ) : (
            <div className="space-y-6">
              {[...byGroup.entries()].map(([gid, list]) => {
                const g = groups.data?.find((x) => x.id === gid);
                return (
                  <section key={gid}>
                    <SectionTitle action={g ? <Link to={`/groups/${g.id}?tab=balances`} className="text-sm font-medium text-primary hover:underline">Open group</Link> : undefined}>
                      <span className="inline-flex items-center gap-2 normal-case tracking-normal">{g ? <GroupBadge emoji={g.emoji} color={g.color} size="sm" /> : null}{g?.name ?? 'Between friends'}</span>
                    </SectionTitle>
                    <Card className="divide-y divide-border">
                      {list.map((e, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2 p-4 text-sm">
                          <span className="font-medium">{nameOf(e.fromId)}</span>
                          <ArrowRight className="size-4 text-fg-subtle" />
                          <span className="font-medium">{nameOf(e.toId)}</span>
                          <span className={`tabular ml-auto font-semibold ${e.toId === me ? 'text-positive' : 'text-negative'}`}>{formatMoney(e.amountMinor, e.currency)}</span>
                          <Button size="sm" variant="outline" onClick={() => setSettle({ groupId: e.groupId, payerId: e.fromId, payeeId: e.toId, amountMinor: e.amountMinor, currency: e.currency })}>Settle</Button>
                        </div>
                      ))}
                    </Card>
                  </section>
                );
              })}
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="flex gap-3 rounded-2xl bg-accent-soft p-4 text-sm text-accent">
              <Sparkles className="mt-0.5 size-4 shrink-0" />
              <p><strong>Debt simplification</strong> suggests the fewest repayments inside a group. It never changes how much anyone is owed in total — it just routes money more directly.</p>
            </div>
            <div className="flex gap-3 rounded-2xl bg-muted p-4 text-sm text-fg-muted">
              <Info className="mt-0.5 size-4 shrink-0" />
              <p>Suggestions are not payments. Pay through your bank or UPI app, then record the repayment here so everyone’s balance updates.</p>
            </div>
          </div>
        </>
      )}
      <SettleUpDialog open={!!settle} onOpenChange={(o) => !o && setSettle(null)} defaults={settle ?? {}} />
    </div>
  );
}
