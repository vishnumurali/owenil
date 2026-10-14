import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, OctagonAlert, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES, budgetFormSchema, evaluateBudgets, formatMoney, minorToDecimalString, parseMoney, type SpendingRow } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { qk, useBudgets, useCategories, useGroups, useMe, useSpending } from '@/data/queries';
import type { Budget } from '@/types/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Progress, Skeleton } from '@/components/ui/misc';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, PageHeader, Stagger, StaggerItem } from '@/components/ui/layout-bits';
import { CategoryIcon, PlusGate } from '@/components/domain';

export default function BudgetsPage() {
  useDocumentTitle('Budgets');
  const me = useMe();
  const qc = useQueryClient();
  const budgets = useBudgets();
  const categories = useCategories();
  const groups = useGroups();
  const today = todayISO();
  const spending = useSpending(`${today.slice(0, 4)}-01-01`, today);
  const [editing, setEditing] = React.useState<Budget | 'new' | null>(null);
  const [deleting, setDeleting] = React.useState<Budget | null>(null);

  const rows: SpendingRow[] = (spending.data ?? []).map((r) => ({
    expenseId: r.expense_id, date: r.expense_date, description: r.description, currency: r.currency, categoryId: r.category_id, groupId: r.group_id,
    totalMinor: r.total_minor, myShareMinor: r.my_share_minor, myPaidMinor: r.my_paid_minor, isRecurring: r.is_recurring, payers: [],
  }));
  const statuses = evaluateBudgets(
    (budgets.data ?? []).map((b) => ({ id: b.id, categoryId: b.category_id, groupId: b.group_id, amountMinor: Number(b.amount_minor), currency: b.currency, period: b.period, alertThresholdPct: b.alert_threshold_pct })),
    rows,
    today,
  );

  if (me.isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (!me.data?.isPlus && (budgets.data?.length ?? 0) === 0) {
    return (
      <div>
        <PageHeader title="Budgets" description="Set limits and get alerted before you overspend." />
        <PlusGate feature="Budgets & alerts" description="Create monthly or yearly budgets for any category or group. Owenil tracks your share and notifies you at your chosen threshold." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Budgets"
        description="Measured on your own share of expenses. Alerts arrive as notifications."
        actions={<Button onClick={() => setEditing('new')} disabled={!me.data?.isPlus}><Plus /> New budget</Button>}
      />
      {budgets.isLoading || spending.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
      ) : statuses.length === 0 ? (
        <Card><EmptyState illustration="chart" title="No budgets yet" description="Try a monthly food budget or a yearly travel budget." action={<Button onClick={() => setEditing('new')}><Plus /> Create a budget</Button>} /></Card>
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2">
          {statuses.map((s) => {
            const b = budgets.data!.find((x) => x.id === s.budget.id)!;
            const cat = b.category_id ? categories.data?.find((c) => c.id === b.category_id) : null;
            const g = b.group_id ? groups.data?.find((x) => x.id === b.group_id) : null;
            const pct = s.ratio * 100;
            const Icon = s.state === 'over' ? OctagonAlert : s.state === 'warning' ? AlertTriangle : CheckCircle2;
            return (
              <StaggerItem key={b.id}>
                <Card className="p-5">
                  <div className="flex items-start gap-3">
                    <CategoryIcon category={cat} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{b.name}</h3>
                      <p className="text-xs text-fg-muted">{cat?.name ?? 'All categories'}{g ? ` · ${g.name}` : ''} · {b.period === 'monthly' ? 'Monthly' : 'Yearly'} · alert at {b.alert_threshold_pct}%</p>
                    </div>
                    <Button size="icon-sm" variant="ghost" aria-label={`Edit ${b.name}`} onClick={() => setEditing(b)}><Pencil /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${b.name}`} onClick={() => setDeleting(b)}><Trash2 /></Button>
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <p className="font-display text-2xl font-semibold tabular">{formatMoney(s.spentMinor, b.currency)}</p>
                    <p className="text-sm text-fg-muted">of {formatMoney(Number(b.amount_minor), b.currency)}</p>
                  </div>
                  <Progress className="mt-2" value={pct} tone={s.state === 'over' ? 'negative' : s.state === 'warning' ? 'warning' : 'positive'} label={`${b.name} budget used`} />
                  <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${s.state === 'over' ? 'text-negative' : s.state === 'warning' ? 'text-warning' : 'text-positive'}`}>
                    <Icon className="size-3.5" />
                    {s.state === 'over' ? `Over by ${formatMoney(-s.remainingMinor, b.currency)}` : `${formatMoney(s.remainingMinor, b.currency)} left`} · {Math.round(pct)}% used
                    <span className="ml-auto font-normal text-fg-subtle">{formatDate(s.periodStart, { day: 'numeric', month: 'short' })} – {formatDate(s.periodEnd, { day: 'numeric', month: 'short' })}</span>
                  </p>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
      {editing && <BudgetDialog budget={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title="Delete budget?" description="This only removes the budget. Your expenses are not affected." confirmLabel="Delete" destructive
        onConfirm={async () => {
          const { error } = await supabase.from('budgets').delete().eq('id', deleting!.id);
          if (error) toast.error(errorMessage(error));
          else void qc.invalidateQueries({ queryKey: qk.budgets });
          setDeleting(null);
        }} />
    </div>
  );
}

function BudgetDialog({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const { user } = useAuth();
  const me = useMe();
  const qc = useQueryClient();
  const categories = useCategories();
  const groups = useGroups();
  const [name, setName] = React.useState(budget?.name ?? '');
  const [categoryId, setCategoryId] = React.useState(budget?.category_id ?? '');
  const [groupId, setGroupId] = React.useState(budget?.group_id ?? '');
  const [currency, setCurrency] = React.useState(budget?.currency ?? me.data?.profile.default_currency ?? 'INR');
  const [amount, setAmount] = React.useState(budget ? minorToDecimalString(Number(budget.amount_minor), budget.currency) : '');
  const [period, setPeriod] = React.useState<'monthly' | 'yearly'>(budget?.period ?? 'monthly');
  const [threshold, setThreshold] = React.useState(String(budget?.alert_threshold_pct ?? 80));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    setError(null);
    const parsed = budgetFormSchema.safeParse({
      category_id: categoryId || null, group_id: groupId || null, amount_minor: parseMoney(amount, currency) ?? 0, currency, period, alert_threshold_pct: Number(threshold),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the values.');
    const finalName = name.trim() || categories.data?.find((c) => c.id === categoryId)?.name || 'Overall';
    setBusy(true);
    const res = budget
      ? await supabase.from('budgets').update({ ...parsed.data, name: finalName }).eq('id', budget.id)
      : await supabase.from('budgets').insert({ ...parsed.data, name: finalName, user_id: user!.id });
    setBusy(false);
    if (res.error) return setError(errorMessage(res.error));
    toast.success(budget ? 'Budget updated' : 'Budget created');
    void qc.invalidateQueries({ queryKey: qk.budgets });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={budget ? 'Edit budget' : 'New budget'}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save budget</Button></>}>
      <div className="space-y-4">
        <Field label="Name" htmlFor="b-name" optional><Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Eating out" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="b-cat">
            <NativeSelect id="b-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Group" htmlFor="b-group">
            <NativeSelect id="b-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Any group</option>
              {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Limit" htmlFor="b-amount"><Input id="b-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular" /></Field>
          <Field label="Currency" htmlFor="b-cur">
            <NativeSelect id="b-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c.code}>{c.code}</option>)}</NativeSelect>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Period" htmlFor="b-period">
            <NativeSelect id="b-period" value={period} onChange={(e) => setPeriod(e.target.value as 'monthly' | 'yearly')}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></NativeSelect>
          </Field>
          <Field label="Alert at (%)" htmlFor="b-th"><Input id="b-th" type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} /></Field>
        </div>
        {error && <p role="alert" className="text-sm text-negative">{error}</p>}
      </div>
    </Dialog>
  );
}
