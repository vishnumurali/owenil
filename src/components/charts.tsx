import * as React from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps,
} from 'recharts';
import { Table2, BarChart3 } from 'lucide-react';
import { formatMoney } from '@owenil/core';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Card } from './ui/card';

/**
 * Chart conventions (see docs/ARCHITECTURE.md › Charts):
 *  - magnitude → single-hue bars in the brand primary; one y-axis only
 *  - two series → validated categorical slots 1 & 2 + legend + direct labels
 *  - every chart has hover tooltips and a table view
 *  - colours are resolved from CSS tokens (SVG attributes can't read var())
 */
const SERIES = {
  light: ['#2a78d6', '#eb6834'],
  dark: ['#3987e5', '#d95926'],
};

function readVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : '#888';
}

export function useChartTheme() {
  const { resolved } = useTheme();
  return React.useMemo(
    () => ({
      primary: readVar('--primary'),
      primary2: readVar('--primary-2'),
      grid: readVar('--border'),
      axis: readVar('--fg-subtle'),
      text: readVar('--fg'),
      surface: readVar('--surface'),
      muted: readVar('--muted'),
      series: SERIES[resolved],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved],
  );
}

export interface ChartDatum {
  label: string;
  value: number;
  /** optional second series */
  value2?: number;
}

function MoneyTooltip({ active, payload, label, currency, names }: TooltipProps<number, string> & { currency: string; names?: [string, string?] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl bg-elevated/95 ring-1 ring-border/70 backdrop-blur-xl px-3 py-2 text-xs shadow-lift">
      <p className="mb-1 font-medium text-fg">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-fg-muted">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {names?.[i] ?? p.name}: <span className="tabular font-semibold text-fg">{formatMoney(Number(p.value), currency)}</span>
        </p>
      ))}
    </div>
  );
}

const axisMoney = (currency: string) => (v: number) => formatMoney(v, currency, { compact: true });

export function MoneyBarChart({ data, currency, height = 240, seriesName = 'Spent' }: { data: ChartDatum[]; currency: string; height?: number; seriesName?: string }) {
  const t = useChartTheme();
  const fillId = `bar-${React.useId().replace(/:/g, '')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={t.primary2} />
            <stop offset="100%" stopColor={t.primary} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={t.grid} strokeDasharray="2 6" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} tickFormatter={axisMoney(currency)} width={56} />
        <Tooltip cursor={{ fill: t.muted, opacity: 0.6 }} content={<MoneyTooltip currency={currency} names={[seriesName]} />} />
        <Bar dataKey="value" name={seriesName} fill={`url(#${fillId})`} radius={[8, 8, 3, 3]} maxBarSize={34} animationDuration={700} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MoneyLineChart({ data, currency, names, height = 260 }: { data: ChartDatum[]; currency: string; names: [string, string?]; height?: number }) {
  const t = useChartTheme();
  const two = data.some((d) => d.value2 !== undefined);
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke={t.grid} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: t.axis, fontSize: 11 }} tickFormatter={axisMoney(currency)} width={56} />
          <Tooltip cursor={{ stroke: t.axis, strokeDasharray: '3 3' }} content={<MoneyTooltip currency={currency} names={names} />} />
          <Line type="monotone" dataKey="value" name={names[0]} stroke={two ? t.series[0] : t.primary} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: t.surface }} activeDot={{ r: 5 }} animationDuration={800} />
          {two && (
            <Line type="monotone" dataKey="value2" name={names[1]} stroke={t.series[1]} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3, strokeWidth: 2, fill: t.surface }} activeDot={{ r: 5 }} animationDuration={800} />
          )}
        </LineChart>
      </ResponsiveContainer>
      {two && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-fg-muted" aria-label="Legend">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded" style={{ background: t.series[0] }} /> {names[0]}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded border-t-2 border-dashed" style={{ borderColor: t.series[1] }} /> {names[1]}
          </span>
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars (categories, payers, groups) — label + value always visible. */
export function RankedBars({
  rows,
  currency,
  max = 8,
  emptyLabel = 'No data yet',
}: {
  rows: { key: string; label: React.ReactNode; value: number; icon?: React.ReactNode }[];
  currency: string;
  max?: number;
  emptyLabel?: string;
}) {
  const shown = rows.slice(0, max);
  const rest = rows.slice(max).reduce((a, r) => a + r.value, 0);
  const all = rest > 0 ? [...shown, { key: '__other', label: 'Other', value: rest, icon: undefined }] : shown;
  const top = Math.max(1, ...all.map((r) => r.value));
  const total = all.reduce((a, r) => a + r.value, 0);
  if (all.length === 0) return <p className="py-8 text-center text-sm text-fg-subtle">{emptyLabel}</p>;
  return (
    <ul className="space-y-3">
      {all.map((r, i) => (
        <li key={r.key} className="group">
          <div className="mb-1 flex items-center gap-2 text-sm">
            {r.icon}
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="tabular font-medium">{formatMoney(r.value, currency)}</span>
            <span className="tabular w-10 text-right text-xs text-fg-subtle">{total ? Math.round((r.value / total) * 100) : 0}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-fg/[0.06]">
            <div
              className="bg-primary-gradient h-full rounded-full transition-[width] duration-700 ease-out-expo"
              style={{ width: `${(r.value / top) * 100}%`, transitionDelay: `${i * 40}ms` }}
              title={`${typeof r.label === 'string' ? r.label : ''} ${formatMoney(r.value, currency)}`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Card wrapper with a chart/table toggle so every chart has an accessible table view. */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  className,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  table?: { headers: string[]; rows: (string | number)[][] };
  className?: string;
  action?: React.ReactNode;
}) {
  const [asTable, setAsTable] = React.useState(false);
  return (
    <Card className={cn('p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="text-xs text-fg-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {table && (
            <button
              type="button"
              onClick={() => setAsTable((v) => !v)}
              className="flex size-8 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-fg/[0.06] hover:text-fg"
              aria-label={asTable ? 'Show chart' : 'Show as table'}
              aria-pressed={asTable}
            >
              {asTable ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}
            </button>
          )}
        </div>
      </div>
      {asTable && table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-fg-subtle">
                {table.headers.map((h) => (
                  <th key={h} className="pb-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  {r.map((c, j) => (
                    <td key={j} className={cn('py-1.5', j > 0 && 'tabular text-right')}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
