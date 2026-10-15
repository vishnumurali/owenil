import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CalendarClock, HandCoins, LayoutGrid, Plus } from 'lucide-react';
import { formatMoney, totalsBy, totalsByMonth, type SpendingRow } from '@owenil/core';
import { useDocumentTitle } from '@/lib/hooks';
import { cn, formatDate, monthLabel, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  useActivity, useBalanceOverview, useCategories, useExpenses, useGroups, useMe, useRecurring, useSettlements, useSpending, useNameOf,
} from '@/data/queries';
import { deriveMyEdges, totalsByCurrency } from '@/data/balances';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AnimatedMoney, Money } from '@/components/ui/money';
import { Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { EmptyState, ErrorState, FitBody, FitScreen } from '@/components/ui/layout-bits';
import { ExpenseRow, CategoryIcon, GroupBadge } from '@/components/domain';
import { ActivityList } from '@/components/activity';
import { ChartCard, MoneyBarChart, RankedBars } from '@/components/charts';

function addMonths(iso: string, n: number) {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

type Panel = 'recent' | 'groups' | 'spending' | 'repayments' | 'activity';
const PANEL_KEY = 'owenil.homePanel';

function savedPanel(): Panel {
  try {
    const v = sessionStorage.getItem(PANEL_KEY);
    if (v === 'recent' || v === 'groups' || v === 'spending' || v === 'repayments' || v === 'activity') return v;
  } catch {
    /* storage unavailable */
  }
  return 'recent';
}

/**
 * Home. Fits one screen: your balance on an ink tile, then one panel at a time
 * (recent expenses, groups, spending, repayments and recurring, activity) that
 * scrolls on its own. Quick actions live on the "+" button.
 */
export default function DashboardPage() {
  useDocumentTitle('Home');
  const { user } = useAuth();
  const me = useMe();
  const groups = useGroups();
  const balances = useBalanceOverview();
  const [panel, setPanelState] = React.useState<Panel>(savedPanel);
  const setPanel = (p: Panel) => {
    setPanelState(p);
    try {
      sessionStorage.setItem(PANEL_KEY, p);
    } catch {
      /* storage unavailable */
    }
  };

  const currency = me.data?.profile.default_currency ?? 'INR';
  const edges = React.useMemo(
    () => (balances.data && groups.data && user ? deriveMyEdges(balances.data, groups.data, user.id) : []),
    [balances.data, groups.data, user],
  );
  const totals = totalsByCurrency(edges, user?.id ?? '');
  const primary = totals.find((t) => t.currency === currency) ?? { currency, owedToMe: 0, iOwe: 0, net: 0 };
  const otherCurrencies = totals.filter((t) => t.currency !== currency);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <FitScreen>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="shrink-0">
            <p className="text-xs text-fg-muted sm:text-sm">{greeting},</p>
            <h1 className="truncate text-xl font-semibold leading-tight sm:text-[1.9rem]">{me.data?.profile.display_name ?? ' '}</h1>
          </div>
          {balances.isError ? (
            <ErrorState error={balances.error} onRetry={() => balances.refetch()} />
          ) : (
            <section aria-label="Your balance" className="hero-card relative shrink-0 overflow-hidden rounded-[30px] p-4 sm:p-5">
              <div className="relative">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Net balance</p>
                  <span className="hero-chip rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white/90">{currency}</span>
                </div>
                {balances.isLoading ? (
                  <Skeleton className="mt-2 h-10 w-40 bg-white/10" />
                ) : (
                  <AnimatedMoney
                    amountMinor={primary.net}
                    currency={currency}
                    signDisplay="exceptZero"
                    className="mt-1.5 block whitespace-nowrap font-display text-[clamp(1.75rem,9vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-white"
                  />
                )}
                <p className="mt-2 flex items-center gap-1.5 truncate text-xs text-white/75 sm:text-sm">
                  <span className={cn('size-2 shrink-0 rounded-full', primary.net > 0 ? 'bg-emerald-300' : primary.net < 0 ? 'bg-rose-300' : 'bg-white/60')} />
                  {primary.net === 0 ? 'You’re all settled up' : primary.net > 0 ? 'Overall, people owe you' : 'Overall, you owe others'}
                  {otherCurrencies.length > 0 && (
                    <span className="ml-1">· also {otherCurrencies.map((t) => formatMoney(t.net, t.currency, { signDisplay: 'exceptZero' })).join(', ')}</span>
                  )}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <BalanceChip to="/balances" label="You are owed" icon={<ArrowDownLeft />} amount={primary.owedToMe} currency={currency} loading={balances.isLoading} tone="positive" action="Details" />
                  <BalanceChip to="/pay" label="You owe" icon={<ArrowUpRight />} amount={primary.iOwe} currency={currency} loading={balances.isLoading} tone="negative" action={primary.iOwe > 0 ? 'Pay now' : 'Details'} />
                </div>
              </div>
            </section>
          )}
          <div className="hidden min-h-0 flex-1 lg:block">
            <SpendingPanel currency={currency} compact />
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Segmented<Panel>
            value={panel}
            onChange={setPanel}
            ariaLabel="Home panels"
            size="sm"
            className="w-full shrink-0"
            options={[
              { value: 'recent', label: 'Recent' },
              { value: 'groups', label: 'Groups' },
              { value: 'spending', label: 'Spending' },
              { value: 'repayments', label: 'Repaid' },
              { value: 'activity', label: 'Activity' },
            ]}
          />
          <FitBody>
            {panel === 'recent' && <RecentPanel />}
            {panel === 'groups' && <GroupsPanel edges={edges} />}
            {panel === 'spending' && <SpendingPanel currency={currency} />}
            {panel === 'repayments' && <RepaymentsPanel />}
            {panel === 'activity' && <ActivityPanel />}
          </FitBody>
        </div>
      </div>
    </FitScreen>
  );
}

function BalanceChip({ to, label, icon, amount, currency, loading, tone, action }: { to: string; label: string; icon: React.ReactNode; amount: number; currency: string; loading: boolean; tone: 'positive' | 'negative'; action: string }) {
  return (
    <Link to={to} className="hero-chip group min-w-0 rounded-[20px] px-3 py-2.5 transition-colors hover:bg-white/[0.16]">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/75 [&_svg]:size-3.5">
        <span className={cn('flex size-5 items-center justify-center rounded-full', tone === 'positive' ? 'bg-emerald-300/25 text-emerald-200' : 'bg-rose-300/25 text-rose-200')}>{icon}</span>
        <span>{label}</span>
      </span>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-24 bg-white/10" />
      ) : (
        <AnimatedMoney amountMinor={amount} currency={currency} className="mt-1 block truncate font-display text-[17px] font-bold tracking-tight text-white sm:text-lg" />
      )}
      <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-white/70 group-hover:text-white">
        {action} <ArrowRight className="size-3" />
      </span>
    </Link>
  );
}

function PanelLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="mt-3 flex items-center justify-center gap-1 rounded-full py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary-soft">
      {children} <ArrowRight className="size-3.5" />
    </Link>
  );
}

function RecentPanel() {
  const recent = useExpenses({ page: 0, pageSize: 8 });
  const categories = useCategories();
  const groups = useGroups();
  const catMap = React.useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  if (recent.isError) return <ErrorState error={recent.error} onRetry={() => recent.refetch()} />;
  return (
    <>
      <Card className="p-2">
        {recent.isLoading ? (
          <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : recent.data?.rows.length ? (
          recent.data.rows.map((e) => <ExpenseRow key={e.id} expense={e} categories={catMap} groupName={groups.data?.find((g) => g.id === e.group_id)?.name} />)
        ) : (
          <EmptyState
            title="No expenses yet"
            description="Add your first shared expense (dinner, rent, a cab) and Owenil works out who owes whom."
            action={<Button asChild><Link to="/expenses/new"><Plus /> Add an expense</Link></Button>}
          />
        )}
      </Card>
      {!!recent.data?.rows.length && <PanelLink to="/expenses">All expenses</PanelLink>}
    </>
  );
}

function GroupsPanel({ edges }: { edges: ReturnType<typeof deriveMyEdges> }) {
  const { user } = useAuth();
  const groups = useGroups();
  const active = (groups.data ?? []).filter((g) => !g.archived_at);
  const groupBalance = (gid: string) => {
    const m = new Map<string, number>();
    for (const e of edges.filter((x) => x.groupId === gid)) m.set(e.currency, (m.get(e.currency) ?? 0) + (e.toId === user?.id ? e.amountMinor : -e.amountMinor));
    return [...m.entries()].filter(([, v]) => v !== 0);
  };
  if (groups.isLoading) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>;
  if (!active.length) {
    return (
      <Card>
        <EmptyState illustration="groups" title="No groups yet" description="Create a group for a trip, your flat or your family." action={<Button asChild variant="outline"><Link to="/groups/new"><LayoutGrid /> Create a group</Link></Button>} />
      </Card>
    );
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {active.map((g) => {
          const bal = groupBalance(g.id);
          return (
            <Link key={g.id} to={`/groups/${g.id}`} className="flex flex-col gap-2 rounded-[22px] tile p-3 transition-transform active:scale-[0.98]">
              <GroupBadge emoji={g.emoji} color={g.color} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{g.name}</span>
                <span className="block text-2xs text-fg-muted">{g.group_members.filter((m) => m.status === 'active').length} members</span>
              </span>
              {bal.length === 0 ? (
                <span className="text-2xs text-fg-subtle">settled up</span>
              ) : (
                bal.map(([c, v]) => (
                  <span key={c} className={cn('text-xs', v > 0 ? 'text-positive' : 'text-negative')}>
                    {v > 0 ? 'you get ' : 'you owe '}
                    <span className="tabular font-semibold">{formatMoney(Math.abs(v), c)}</span>
                  </span>
                ))
              )}
            </Link>
          );
        })}
      </div>
      <PanelLink to="/groups">All groups</PanelLink>
    </>
  );
}

function SpendingPanel({ currency, compact }: { currency: string; compact?: boolean }) {
  const categories = useCategories();
  const today = todayISO();
  const from = addMonths(today, -5);
  const spending = useSpending(from, today);
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
  const chart = (
    <ChartCard
      title="Monthly spending"
      subtitle={`Your share, last 6 months (${currency})`}
      table={{ headers: ['Month', 'Your share'], rows: monthly.map((m) => [m.label, formatMoney(m.value, currency)]) }}
    >
      {spending.isLoading ? <Skeleton className="h-44 w-full" /> : <MoneyBarChart data={monthly} currency={currency} seriesName="Your share" height={compact ? 150 : 190} />}
    </ChartCard>
  );
  if (compact) return chart;
  return (
    <div className="space-y-3">
      {chart}
      <ChartCard title="This month by category" subtitle={`Your share in ${currency}`}>
        {spending.isLoading ? (
          <Skeleton className="h-40 w-full" />
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
  );
}

function RepaymentsPanel() {
  const settlements = useSettlements({ limit: 6 });
  const recurring = useRecurring();
  const nameOf = useNameOf();
  const upcoming = (recurring.data ?? []).filter((t) => t.status === 'active' && t.next_occurrence_on).slice(0, 4);
  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">Recent repayments</h2>
        <Card className="p-2">
          {settlements.data?.length ? (
            settlements.data.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
                <span className="flex size-9 items-center justify-center rounded-full bg-positive-soft text-positive">
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
            <p className="px-3 py-6 text-center text-sm text-fg-subtle">{settlements.isLoading ? 'Loading…' : 'No repayments recorded yet.'}</p>
          )}
        </Card>
        <PanelLink to="/settlements">Repayment history</PanelLink>
      </section>
      <section>
        <h2 className="mb-2 px-1 text-2xs font-semibold uppercase tracking-wider text-fg-subtle">Upcoming recurring</h2>
        <Card className="p-2">
          {upcoming.length ? (
            upcoming.map((t) => (
              <Link key={t.id} to="/recurring" className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-fg/[0.05]">
                <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent">
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
            <p className="px-3 py-6 text-center text-sm text-fg-subtle">{recurring.isLoading ? 'Loading…' : 'No upcoming recurring expenses.'}</p>
          )}
        </Card>
      </section>
    </div>
  );
}

function ActivityPanel() {
  const activity = useActivity(null, 20);
  return (
    <Card className="p-2">
      {activity.data?.length ? (
        <ActivityList events={activity.data} compact />
      ) : (
        <p className="px-3 py-8 text-center text-sm text-fg-subtle">{activity.isLoading ? 'Loading…' : 'Activity from your groups and friends shows up here.'}</p>
      )}
    </Card>
  );
}
