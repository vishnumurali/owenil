import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import {
  contributionsByPayer, formatMoney, largestExpenses, percentChange, sumMeasure, totalsBy, totalsByMonth, totalsByWeek, totalsByYear,
  type Measure, type SpendingRow,
} from '@owenil/core';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate, monthLabel, todayISO } from '@/lib/utils';
import { useCategories, useGroups, useMe, useNameOf, useRates, useSettlements, useSpending } from '@/data/queries';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/input';
import { Badge, Skeleton, Switch } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { EmptyState, ErrorState, PageHeader, Stagger, StaggerItem } from '@/components/ui/layout-bits';
import { ChartCard, MoneyBarChart, MoneyLineChart, RankedBars } from '@/components/charts';
import { CategoryIcon, PlusGate } from '@/components/domain';
import { convertRows } from './fx';

type Range = '6m' | '12m' | 'ytd' | '24m';

function rangeStart(range: Range, today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const back = (months: number) => new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 10);
  if (range === 'ytd') return `${y}-01-01`;
  return back(range === '6m' ? 5 : range === '12m' ? 11 : 23);
}

export default function AnalyticsPage() {
  useDocumentTitle('Analytics');
  const me = useMe();
  const isPlus = !!me.data?.isPlus;
  const today = todayISO();
  const [range, setRange] = React.useState<Range>('6m');
  const [measure, setMeasure] = React.useState<Measure>('myShareMinor');
  const [currency, setCurrency] = React.useState<string | null>(null);
  const [convert, setConvert] = React.useState(false);
  const from = rangeStart(isPlus ? range : '6m', today);
  // Fetch an extra year so year-over-year comparisons have data.
  const fetchFrom = `${Number(from.slice(0, 4)) - 1}${from.slice(4)}`;
  const spending = useSpending(fetchFrom, today);
  const categories = useCategories();
  const groups = useGroups();
  const rates = useRates();
  const settlements = useSettlements({ limit: 500 });
  const nameOf = useNameOf();

  const reportCurrency = currency ?? me.data?.preferences.report_currency ?? me.data?.profile.default_currency ?? 'INR';
  const allRows: SpendingRow[] = React.useMemo(
    () =>
      (spending.data ?? []).map((r) => ({
        expenseId: r.expense_id, date: r.expense_date, description: r.description, currency: r.currency, categoryId: r.category_id, groupId: r.group_id,
        totalMinor: r.total_minor, myShareMinor: r.my_share_minor, myPaidMinor: r.my_paid_minor, isRecurring: r.is_recurring,
        payers: r.payers.map((p) => ({ userId: p.user_id, amountMinor: Number(p.amount_minor) })),
      })),
    [spending.data],
  );
  const currenciesSeen = [...new Set(allRows.map((r) => r.currency))];
  const { rows: scoped, excluded } = React.useMemo(() => {
    if (convert && isPlus) return convertRows(allRows, reportCurrency, rates.data ?? []);
    const ex = new Map<string, number>();
    for (const r of allRows) if (r.currency !== reportCurrency) ex.set(r.currency, (ex.get(r.currency) ?? 0) + 1);
    return { rows: allRows.filter((r) => r.currency === reportCurrency), excluded: ex, converted: 0 };
  }, [allRows, convert, isPlus, reportCurrency, rates.data]);
  const rows = scoped.filter((r) => r.date >= from);
  const prevRows = scoped.filter((r) => r.date < from);

  const catMap = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const monthly = totalsByMonth(rows, measure, from.slice(0, 7), today.slice(0, 7));
  const thisMonth = monthly[monthly.length - 1]?.amountMinor ?? 0;
  const lastMonth = monthly[monthly.length - 2]?.amountMinor ?? 0;
  const change = percentChange(lastMonth, thisMonth);
  const total = sumMeasure(rows, measure);
  const measureLabel = measure === 'myShareMinor' ? 'Your share' : measure === 'myPaidMinor' ? 'You paid' : 'Total of shared expenses';

  // Year-over-year: this period's months vs the same months a year earlier.
  const yoy = monthly.map((m) => {
    const [y, mo] = m.period.split('-');
    const prev = `${Number(y) - 1}-${mo}`;
    return { label: monthLabel(m.period), value: m.amountMinor, value2: prevRows.filter((r) => r.date.startsWith(prev)).reduce((a, r) => a + r[measure], 0) + rows.filter((r) => r.date.startsWith(prev)).reduce((a, r) => a + r[measure], 0) };
  });
  const recurringTotal = rows.filter((r) => r.isRecurring).reduce((a, r) => a + r[measure], 0);
  const settledTotal = (settlements.data ?? []).filter((s) => !s.reversed_at && s.currency === reportCurrency && s.settled_on >= from).reduce((a, s) => a + Number(s.amount_minor), 0);

  if (spending.isError) return <ErrorState error={spending.error} onRetry={() => spending.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Where shared money goes. Figures come from your recorded expenses." />

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <Segmented<Range> size="sm" value={isPlus ? range : '6m'} onChange={setRange} ariaLabel="Date range"
          options={[{ value: '6m', label: '6 months' }, { value: '12m', label: '12 months', disabled: !isPlus }, { value: 'ytd', label: 'This year', disabled: !isPlus }, { value: '24m', label: '2 years', disabled: !isPlus }]} />
        <Segmented<Measure> size="sm" value={measure} onChange={setMeasure} ariaLabel="Measure"
          options={[{ value: 'myShareMinor', label: 'My share' }, { value: 'myPaidMinor', label: 'I paid' }, { value: 'totalMinor', label: 'Expense totals' }]} />
        <NativeSelect value={reportCurrency} onChange={(e) => setCurrency(e.target.value)} aria-label="Report currency" className="h-8 w-28 text-xs">
          {[...new Set([reportCurrency, ...currenciesSeen])].map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
        {isPlus && currenciesSeen.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <Switch checked={convert} onCheckedChange={setConvert} aria-label="Convert other currencies" /> Convert with my saved rates
          </label>
        )}
        {!isPlus && <span className="text-xs text-fg-muted">Longer ranges & detailed reports with <Link to="/plus" className="font-medium text-plus hover:underline">Plus</Link></span>}
      </Card>

      {excluded.size > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-muted px-4 py-3 text-xs text-fg-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Showing {reportCurrency} only. Not included: {[...excluded.entries()].map(([c, n]) => `${n} in ${c}`).join(', ')}.{' '}
          {isPlus ? (convert ? <>Add rates for these in <Link to="/settings/currency" className="font-medium text-primary hover:underline">Currency settings</Link>.</> : 'Turn on conversion to include them using your recorded rates.') : 'Owenil never adds different currencies together without a rate you choose.'}
        </p>
      )}
      {convert && isPlus && <Badge tone="accent">Converted figures use your manually recorded rate snapshots, not live rates.</Badge>}

      {spending.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      ) : allRows.length === 0 ? (
        <Card><EmptyState illustration="chart" title="No spending yet" description="Add a few expenses and your trends will appear here." /></Card>
      ) : (
        <>
          <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StaggerItem><Stat label={`${measureLabel} · period`} value={formatMoney(total, reportCurrency)} /></StaggerItem>
            <StaggerItem>
              <Stat label="This month" value={formatMoney(thisMonth, reportCurrency)}
                extra={change === null ? <span className="text-xs text-fg-subtle">no data last month</span> : (
                  <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${change > 0 ? 'text-negative' : 'text-positive'}`}>
                    {change > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(change).toFixed(0)}% vs last month
                  </span>
                )} />
            </StaggerItem>
            <StaggerItem><Stat label="Monthly average" value={formatMoney(monthly.length ? Math.round(total / monthly.length) : 0, reportCurrency)} /></StaggerItem>
            <StaggerItem><Stat label="Expenses" value={String(rows.length)} extra={<span className="text-xs text-fg-subtle">{rows.filter((r) => r.isRecurring).length} recurring</span>} /></StaggerItem>
          </Stagger>

          <div className="grid gap-6 lg:grid-cols-5">
            <ChartCard className="lg:col-span-3" title="Monthly spending" subtitle={`${measureLabel} (${reportCurrency})`}
              table={{ headers: ['Month', measureLabel], rows: monthly.map((m) => [monthLabel(m.period), formatMoney(m.amountMinor, reportCurrency)]) }}>
              <MoneyBarChart data={monthly.map((m) => ({ label: monthLabel(m.period), value: m.amountMinor }))} currency={reportCurrency} seriesName={measureLabel} />
            </ChartCard>
            <ChartCard className="lg:col-span-2" title="By category" subtitle="Selected period">
              <RankedBars currency={reportCurrency} rows={totalsBy(rows, 'categoryId', measure).map((c) => ({
                key: c.key ?? 'none', label: c.key ? catMap.get(c.key)?.name ?? 'Other' : 'Uncategorised', value: c.amountMinor,
                icon: <CategoryIcon category={c.key ? catMap.get(c.key) : null} size="sm" className="size-6 rounded-md" />,
              }))} />
            </ChartCard>
          </div>

          {isPlus ? (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <ChartCard title="Weekly spending" subtitle="Last 12 weeks"
                  table={{ headers: ['Week of', measureLabel], rows: totalsByWeek(scoped, measure, 12, today).map((w) => [formatDate(w.period), formatMoney(w.amountMinor, reportCurrency)]) }}>
                  <MoneyBarChart data={totalsByWeek(scoped, measure, 12, today).map((w) => ({ label: formatDate(w.period, { day: 'numeric', month: 'short' }), value: w.amountMinor }))} currency={reportCurrency} seriesName={measureLabel} height={220} />
                </ChartCard>
                <ChartCard title="Compared with a year earlier" subtitle="Same months, previous year"
                  table={{ headers: ['Month', 'This period', 'Year before'], rows: yoy.map((y) => [y.label, formatMoney(y.value, reportCurrency), formatMoney(y.value2, reportCurrency)]) }}>
                  <MoneyLineChart data={yoy} currency={reportCurrency} names={['This period', 'Year before']} height={220} />
                </ChartCard>
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <ChartCard title="By group">
                  <RankedBars currency={reportCurrency} rows={totalsBy(rows, 'groupId', measure).map((g) => ({ key: g.key ?? 'none', label: g.key ? groups.data?.find((x) => x.id === g.key)?.name ?? 'Former group' : 'Between friends', value: g.amountMinor }))} />
                </ChartCard>
                <ChartCard title="Who paid" subtitle="Contributions to expenses you’re part of">
                  <RankedBars currency={reportCurrency} rows={contributionsByPayer(rows).map((p) => ({ key: p.userId, label: nameOf(p.userId), value: p.amountMinor }))} />
                </ChartCard>
                <ChartCard title="Yearly totals" table={{ headers: ['Year', measureLabel], rows: totalsByYear(scoped, measure).map((y) => [y.period, formatMoney(y.amountMinor, reportCurrency)]) }}>
                  <RankedBars currency={reportCurrency} rows={totalsByYear(scoped, measure).reverse().map((y) => ({ key: y.period, label: y.period, value: y.amountMinor }))} />
                </ChartCard>
              </div>
              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <Card className="p-5">
                  <h3 className="mb-3 font-semibold">Largest expenses</h3>
                  <ul className="divide-y divide-border">
                    {largestExpenses(rows, 6, measure).map((r) => (
                      <li key={r.expenseId}>
                        <Link to={`/expenses/${r.expenseId}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary">
                          <CategoryIcon category={r.categoryId ? catMap.get(r.categoryId) : null} size="sm" />
                          <span className="min-w-0 flex-1 truncate">{r.description}</span>
                          <span className="text-xs text-fg-subtle">{formatDate(r.date)}</span>
                          <span className="tabular w-28 text-right font-semibold">{formatMoney(r[measure], reportCurrency)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
                <div className="space-y-4">
                  <Stat label="Recurring expenses · period" value={formatMoney(recurringTotal, reportCurrency)} />
                  <Stat label="Repayments recorded · period" value={formatMoney(settledTotal, reportCurrency)} extra={<span className="text-xs text-fg-subtle">{reportCurrency} only</span>} />
                  <Link to="/budgets" className="block rounded-2xl border border-border bg-surface p-5 text-sm font-medium shadow-card hover:border-primary">Budgets vs actual →</Link>
                </div>
              </div>
            </>
          ) : (
            <PlusGate feature="Detailed analytics" description="Weekly and yearly views, year-over-year comparisons, group and payer breakdowns, largest expenses, and currency conversion." />
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <Card className="h-full p-5">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular">{value}</p>
      {extra && <div className="mt-1">{extra}</div>}
    </Card>
  );
}
