import * as React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarClock, HandCoins, LayoutGrid, Plus, Scale, UserPlus } from 'lucide-react';
import { formatMoney, totalsBy, totalsByMonth, type SpendingRow } from '@owenil/core';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate, monthLabel, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useActivity, useBalanceOverview, useCategories, useExpenses, useGroups, useMe, useRecurring, useSettlements, useSpending, useNameOf,
} from '@/data/queries';
import { deriveMyEdges, totalsByCurrency } from '@/data/balances';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AnimatedMoney, Money } from '@/components/ui/money';
import { Skeleton, Badge } from '@/components/ui/misc';
import { EmptyState, ErrorState, SectionTitle, Stagger, StaggerItem } from '@/components/ui/layout-bits';
import { ExpenseRow, CategoryIcon, GroupBadge } from '@/components/domain';
import { ActivityList } from '@/components/activity';
import { ChartCard, MoneyBarChart, RankedBars } from '@/components/charts';
import { SettleUpDialog } from '@/features/balances/SettleUpDialog';
import { InviteFriendDialog } from '@/features/friends/InviteFriendDialog';

function addMonths(iso: string, n: number) {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  useDocumentTitle('Dashboard');
  const { user } = useAuth();
  const me = useMe();
  const groups = useGroups();
  const balances = useBalanceOverview();
  const categories = useCategories();
  const recent = useExpenses({ page: 0, pageSize: 6 });
  const settlements = useSettlements({ limit: 5 });
  const activity = useActivity(null, 8);
  const recurring = useRecurring();
  const nameOf = useNameOf();
  const today = todayISO();
  const from = addMonths(today, -5);
  const spending = useSpending(from, today);
  const [settleOpen, setSettleOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);

  const currency = me.data?.profile.default_currency ?? 'INR';
  const edges = React.useMemo(
    () => (balances.data && groups.data && user ? deriveMyEdges(balances.data, groups.data, user.id) : []),
    [balances.data, groups.data, user],
  );
  const totals = totalsByCurrency(edges, user?.id ?? '');
  const primary = totals.find((t) => t.currency === currency) ?? { currency, owedToMe: 0, iOwe: 0, net: 0 };
  const otherCurrencies = totals.filter((t) => t.currency !== currency);

  const catMap = React.useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const rows: SpendingRow[] = React.useMemo(
    () =>
      (spending.data ?? [])
        .filter((r) => r.currency === currency)
        .map((r) => ({
          expenseId: r.expense_id, date: r.expense_date, description: r.description, currency: r.currency, categoryId: r.category_id,
          groupId: r.group_id, totalMinor: r.total_minor, myShareMinor: r.my_share_minor, myPaidMinor: r.my_paid_minor,
          isRecurring: r.is_recurring, payers: r.payers.map((p) => ({ userId: p.user_id, amountMinor: Number(p.amount_minor) })),
        })),
    [spending.data, currency],
  );
  const monthly = totalsByMonth(rows, 'myShareMinor', from.slice(0, 7), today.slice(0, 7)).map((p) => ({ label: monthLabel(p.period), value: p.amountMinor }));
  const thisMonth = rows.filter((r) => r.date.startsWith(today.slice(0, 7)));
  const byCat = totalsBy(thisMonth, 'categoryId', 'myShareMinor');
  const groupBalance = (gid: string) => {
    const m = new Map<string, number>();
    for (const e of edges.filter((x) => x.groupId === gid)) m.set(e.currency, (m.get(e.currency) ?? 0) + (e.toId === user?.id ? e.amountMinor : -e.amountMinor));
    return [...m.entries()].filter(([, v]) => v !== 0);
  };
  const activeGroups = (groups.data ?? []).filter((g) => !g.archived_at).slice(0, 4);
  const upcoming = (recurring.data ?? []).filter((t) => t.status === 'active' && t.next_occurrence_on).slice(0, 4);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-fg-muted">{greeting},</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">{me.data?.profile.display_name ?? ' '}</h1>
        </div>
        <QuickActions onSettle={() => setSettleOpen(true)} onInvite={() => setInviteOpen(true)} />
      </div>

      {balances.isError ? (
        <ErrorState error={balances.error} onRetry={() => balances.refetch()} />
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-3">
          <StaggerItem>
            <BalanceCard label="You are owed" icon={<ArrowDownLeft />} tone="positive" loading={balances.isLoading} amount={primary.owedToMe} currency={currency} />
          </StaggerItem>
          <StaggerItem>
            <BalanceCard label="You owe" icon={<ArrowUpRight />} tone="negative" loading={balances.isLoading} amount={primary.iOwe} currency={currency} to="/pay" linkText={primary.iOwe > 0 ? 'Pay now' : 'See details'} />
          </StaggerItem>
          <StaggerItem>
            <Card className="relative h-full overflow-hidden p-5">
              <div className="absolute inset-0 bg-brand-gradient opacity-[0.07]" />
              <div className="relative">
                <p className="flex items-center gap-2 text-sm font-medium text-fg-muted">
                  <Scale className="size-4" /> Net balance
                </p>
                {balances.isLoading ? (
                  <Skeleton className="mt-3 h-9 w-36" />
                ) : (
                  <AnimatedMoney amountMinor={primary.net} currency={currency} tone="auto" signDisplay="exceptZero" className="mt-2 block font-display text-3xl font-semibold" />
                )}
                <p className="mt-1 text-xs text-fg-muted">
                  {primary.net === 0 ? 'You’re all settled up' : primary.net > 0 ? 'Overall, people owe you' : 'Overall, you owe others'}
                </p>
                {otherCurrencies.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {otherCurrencies.map((t) => (
                      <Badge key={t.currency} tone={t.net >= 0 ? 'positive' : 'negative'}>
                        {formatMoney(t.net, t.currency, { signDisplay: 'exceptZero' })}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </StaggerItem>
        </Stagger>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <ChartCard
          className="lg:col-span-3"
          title="Monthly spending"
          subtitle={`Your share, last 6 months (${currency})`}
          table={{ headers: ['Month', 'Your share'], rows: monthly.map((m) => [m.label, formatMoney(m.value, currency)]) }}
        >
          {spending.isLoading ? <Skeleton className="h-60 w-full" /> : <MoneyBarChart data={monthly} currency={currency} seriesName="Your share" />}
        </ChartCard>
        <ChartCard className="lg:col-span-2" title="This month by category" subtitle={`Your share in ${currency}`}>
          {spending.isLoading ? (
            <Skeleton className="h-60 w-full" />
          ) : (
            <RankedBars
              currency={currency}
              max={5}
              emptyLabel="No spending recorded this month"
              rows={byCat.map((c) => {
                const cat = c.key ? catMap.get(c.key) : null;
                return { key: c.key ?? 'none', label: cat?.name ?? 'Uncategorised', value: c.amountMinor, icon: <CategoryIcon category={cat} size="sm" className="size-6 rounded-md" /> };
              })}
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionTitle action={<Link to="/expenses" className="text-sm font-medium text-primary hover:underline">View all</Link>}>Recent expenses</SectionTitle>
          <Card className="p-2">
            {recent.isLoading ? (
              <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : recent.isError ? (
              <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
            ) : recent.data?.rows.length ? (
              recent.data.rows.map((e) => <ExpenseRow key={e.id} expense={e} categories={catMap} groupName={groups.data?.find((g) => g.id === e.group_id)?.name} />)
            ) : (
              <EmptyState
                title="No expenses yet"
                description="Add your first shared expense — dinner, rent, a cab — and Owenil will work out who owes whom."
                action={<Button asChild><Link to="/expenses/new"><Plus /> Add an expense</Link></Button>}
              />
            )}
          </Card>
        </section>
        <section className="lg:col-span-2">
          <SectionTitle action={<Link to="/groups" className="text-sm font-medium text-primary hover:underline">All groups</Link>}>Active groups</SectionTitle>
          <Card className="divide-y divide-border">
            {groups.isLoading ? (
              <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : activeGroups.length ? (
              activeGroups.map((g) => {
                const bal = groupBalance(g.id);
                return (
                  <Link key={g.id} to={`/groups/${g.id}`} className="flex items-center gap-3 p-4 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/50">
                    <GroupBadge emoji={g.emoji} color={g.color} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{g.name}</p>
                      <p className="text-xs text-fg-muted">{g.group_members.filter((m) => m.status === 'active').length} members</p>
                    </div>
                    <div className="text-right text-sm">
                      {bal.length === 0 ? (
                        <span className="text-xs text-fg-subtle">settled up</span>
                      ) : (
                        bal.map(([c, v]) => (
                          <p key={c} className={v > 0 ? 'text-positive' : 'text-negative'}>
                            <span className="text-2xs">{v > 0 ? 'you get' : 'you owe'} </span>
                            <span className="tabular font-semibold">{formatMoney(Math.abs(v), c)}</span>
                          </p>
                        ))
                      )}
                    </div>
                  </Link>
                );
              })
            ) : (
              <EmptyState illustration="groups" title="No groups yet" description="Create a group for a trip, your flat or your family." action={<Button asChild variant="outline"><Link to="/groups/new"><LayoutGrid /> Create a group</Link></Button>} />
            )}
          </Card>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section>
          <SectionTitle action={<Link to="/settlements" className="text-sm font-medium text-primary hover:underline">History</Link>}>Recent repayments</SectionTitle>
          <Card className="p-2">
            {settlements.data?.length ? (
              settlements.data.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-positive-soft text-positive">
                    <HandCoins className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className={`truncate ${s.reversed_at ? 'line-through opacity-60' : ''}`}>
                      {nameOf(s.payer_id)} → {nameOf(s.payee_id)}
                    </p>
                    <p className="text-xs text-fg-subtle">{formatDate(s.settled_on)}</p>
                  </div>
                  <Money amountMinor={Number(s.amount_minor)} currency={s.currency} className="text-sm font-semibold" />
                </div>
              ))
            ) : (
              <p className="px-3 py-8 text-center text-sm text-fg-subtle">{settlements.isLoading ? 'Loading…' : 'No repayments recorded yet.'}</p>
            )}
          </Card>
        </section>
        <section>
          <SectionTitle action={<Link to="/recurring" className="text-sm font-medium text-primary hover:underline">Manage</Link>}>Upcoming recurring</SectionTitle>
          <Card className="p-2">
            {upcoming.length ? (
              upcoming.map((t) => (
                <Link key={t.id} to="/recurring" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted/60">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <CalendarClock className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="truncate font-medium">{t.description}</p>
                    <p className="text-xs text-fg-subtle">Next: {formatDate(t.next_occurrence_on!)}</p>
                  </div>
                  <Money amountMinor={Number(t.amount_minor)} currency={t.currency} className="text-sm font-semibold" />
                </Link>
              ))
            ) : (
              <p className="px-3 py-8 text-center text-sm text-fg-subtle">{recurring.isLoading ? 'Loading…' : 'No upcoming recurring expenses.'}</p>
            )}
          </Card>
        </section>
        <section>
          <SectionTitle>Recent activity</SectionTitle>
          <Card className="p-2">
            {activity.data?.length ? (
              <ActivityList events={activity.data} compact />
            ) : (
              <p className="px-3 py-8 text-center text-sm text-fg-subtle">{activity.isLoading ? 'Loading…' : 'Activity from your groups and friends shows up here.'}</p>
            )}
          </Card>
        </section>
      </div>

      <SettleUpDialog open={settleOpen} onOpenChange={setSettleOpen} defaults={{ currency }} />
      <InviteFriendDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function BalanceCard({ label, icon, tone, amount, currency, loading, to = '/balances', linkText = 'See details' }: { label: string; icon: React.ReactNode; tone: 'positive' | 'negative'; amount: number; currency: string; loading: boolean; to?: string; linkText?: string }) {
  return (
    <Card className="h-full p-5">
      <p className="flex items-center gap-2 text-sm font-medium text-fg-muted">
        <span className={`flex size-7 items-center justify-center rounded-lg [&_svg]:size-4 ${tone === 'positive' ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative'}`}>{icon}</span>
        {label}
      </p>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-32" />
      ) : (
        <AnimatedMoney amountMinor={amount} currency={currency} className={`mt-2 block font-display text-3xl font-semibold ${amount === 0 ? 'text-fg' : tone === 'positive' ? 'text-positive' : 'text-negative'}`} />
      )}
      <Link to={to} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
        {linkText} <ArrowRight className="size-3" />
      </Link>
    </Card>
  );
}

function QuickActions({ onSettle, onInvite }: { onSettle: () => void; onInvite: () => void }) {
  const actions = [
    { label: 'Add expense', icon: Plus, to: '/expenses/new', primary: true },
    { label: 'Create group', icon: LayoutGrid, to: '/groups/new' },
    { label: 'Invite friend', icon: UserPlus, onClick: onInvite },
    { label: 'Record repayment', icon: HandCoins, onClick: onSettle },
    { label: 'Balances', icon: Scale, to: '/balances' },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:flex-wrap sm:px-0">
      {actions.map((a) =>
        a.to ? (
          <Button key={a.label} asChild variant={a.primary ? 'primary' : 'outline'} size="sm" className="shrink-0">
            <Link to={a.to}>
              <a.icon /> {a.label}
            </Link>
          </Button>
        ) : (
          <Button key={a.label} variant="outline" size="sm" className="shrink-0" onClick={a.onClick}>
            <a.icon /> {a.label}
          </Button>
        ),
      )}
    </motion.div>
  );
}
