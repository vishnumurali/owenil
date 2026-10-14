import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, ChevronDown, Pause, Pencil, Play, Plus, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  FREQUENCY_LABELS, computeSplit, formatMoney, minorToDecimalString, parseMoney, upcomingOccurrences, type Frequency,
} from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { invalidateFinancial, useGroups, useMe, useNameOf, useRecurring } from '@/data/queries';
import type { RecurringTemplate } from '@/types/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/input';
import { Badge, Skeleton } from '@/components/ui/misc';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader, Stagger, StaggerItem } from '@/components/ui/layout-bits';
import { GroupBadge } from '@/components/domain';

export default function RecurringPage() {
  useDocumentTitle('Recurring');
  const qc = useQueryClient();
  const templates = useRecurring();
  const [running, setRunning] = React.useState(false);

  const runNow = async () => {
    setRunning(true);
    try {
      const n = unwrap(await supabase.rpc('run_due_recurring_now')) as number;
      toast.success(n ? `Created ${n} due expense${n === 1 ? '' : 's'}` : 'Nothing was due — everything is up to date');
      invalidateFinancial(qc);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const list = templates.data ?? [];
  const active = list.filter((t) => t.status !== 'cancelled');
  const cancelled = list.filter((t) => t.status === 'cancelled');

  return (
    <div>
      <PageHeader
        title="Recurring expenses"
        description="Rent, subscriptions and bills that repeat. They’re created automatically on the server every hour."
        actions={
          <>
            <Button variant="outline" onClick={runNow} loading={running}><RefreshCw /> Run due now</Button>
            <Button asChild><Link to="/expenses/new?repeat=1"><Plus /> New recurring</Link></Button>
          </>
        }
      />
      {templates.isError ? (
        <ErrorState error={templates.error} onRetry={() => templates.refetch()} />
      ) : templates.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
      ) : active.length === 0 && cancelled.length === 0 ? (
        <Card>
          <EmptyState illustration="recurring" title="No recurring expenses" description="Turn on “Repeat this expense” when adding an expense, and Owenil will add it on schedule." action={<Button asChild><Link to="/expenses/new?repeat=1"><Plus /> Create one</Link></Button>} />
        </Card>
      ) : (
        <Stagger className="space-y-3">
          {active.map((t) => <StaggerItem key={t.id}><TemplateCard t={t} /></StaggerItem>)}
          {cancelled.length > 0 && (
            <details className="group pt-4">
              <summary className="flex cursor-pointer items-center gap-1 text-sm font-medium text-fg-muted">
                <ChevronDown className="size-4 transition-transform group-open:rotate-180" /> Cancelled ({cancelled.length})
              </summary>
              <div className="mt-3 space-y-3">{cancelled.map((t) => <TemplateCard key={t.id} t={t} />)}</div>
            </details>
          )}
        </Stagger>
      )}
    </div>
  );
}

function TemplateCard({ t }: { t: RecurringTemplate }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const groups = useGroups();
  const nameOf = useNameOf();
  const [busy, setBusy] = React.useState(false);
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [showHistory, setShowHistory] = React.useState(false);
  const g = groups.data?.find((x) => x.id === t.group_id);
  const canManage = t.created_by === user?.id || !!g?.group_members.some((m) => m.user_id === user?.id && m.status === 'active' && m.role !== 'member');
  const upcoming = t.status === 'active' && t.next_occurrence_on ? upcomingOccurrences(t.start_date, t.frequency, t.next_occurrence_on, 3, t.end_date) : [];
  const history = useQuery({
    queryKey: ['occurrences', t.id],
    enabled: showHistory,
    queryFn: async () => unwrap(await supabase.from('recurring_expense_occurrences').select('*').eq('template_id', t.id).order('occurrence_date', { ascending: false }).limit(24)) as { id: string; occurrence_date: string; status: string; expense_id: string | null; error: string | null }[],
  });

  const setStatus = async (status: 'active' | 'paused' | 'cancelled') => {
    setBusy(true);
    try {
      unwrap(await supabase.rpc('set_recurring_status', { p_template_id: t.id, p_status: status }));
      toast.success(status === 'active' ? 'Resumed' : status === 'paused' ? 'Paused' : 'Future occurrences cancelled');
      invalidateFinancial(qc);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirmCancel(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-4">
        {g ? <GroupBadge emoji={g.emoji} color={g.color} /> : <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent"><CalendarClock className="size-5" /></span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{t.description}</h3>
            <Badge tone={t.status === 'active' ? 'positive' : t.status === 'paused' ? 'warning' : 'neutral'}>{t.status}</Badge>
            {t.is_demo && <Badge tone="warning">Demo</Badge>}
          </div>
          <p className="text-sm text-fg-muted">
            {formatMoney(Number(t.amount_minor), t.currency)} · {FREQUENCY_LABELS[t.frequency]} · {g ? g.name : 'Between friends'} · paid by {t.payload.payers.map((p) => nameOf(p.user_id)).join(', ')}
          </p>
          <p className="mt-1 text-xs text-fg-subtle">
            Started {formatDate(t.start_date)}{t.end_date ? ` · ends ${formatDate(t.end_date)}` : ''}
            {upcoming.length > 0 && <> · next: {upcoming.map((d) => formatDate(d, { day: 'numeric', month: 'short' })).join(', ')}</>}
            {t.status === 'active' && !t.next_occurrence_on && ' · schedule finished'}
          </p>
          {t.last_error && (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning-soft px-2.5 py-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Paused after an error: {t.last_error}
            </p>
          )}
        </div>
        {canManage && t.status !== 'cancelled' && (
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>
            {t.status === 'active' ? (
              <Button size="sm" variant="outline" onClick={() => setStatus('paused')} loading={busy}><Pause /> Pause</Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setStatus('active')} loading={busy}><Play /> Resume</Button>
            )}
            <Button size="sm" variant="danger-ghost" onClick={() => setConfirmCancel(true)}><XCircle /> Cancel</Button>
          </div>
        )}
      </div>
      <button onClick={() => setShowHistory((s) => !s)} className="mt-3 text-xs font-medium text-primary hover:underline" aria-expanded={showHistory}>
        {showHistory ? 'Hide history' : 'Show created expenses'}
      </button>
      {showHistory && (
        <ul className="mt-2 space-y-1 text-sm">
          {history.isLoading && <li className="text-fg-subtle">Loading…</li>}
          {history.data?.length === 0 && <li className="text-fg-subtle">Nothing created yet.</li>}
          {history.data?.map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <span className="w-28 text-fg-muted">{formatDate(o.occurrence_date)}</span>
              {o.status === 'created' && o.expense_id ? <Link to={`/expenses/${o.expense_id}`} className="text-primary hover:underline">View expense</Link> : <span className="text-warning">{o.status}{o.error ? `: ${o.error}` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={confirmCancel} onOpenChange={setConfirmCancel} title="Cancel future occurrences?" description="No more expenses will be created. Expenses already created stay as they are." confirmLabel="Cancel schedule" destructive loading={busy} onConfirm={() => setStatus('cancelled')} />
      {editOpen && <EditTemplateDialog t={t} onClose={() => setEditOpen(false)} />}
    </Card>
  );
}

function EditTemplateDialog({ t, onClose }: { t: RecurringTemplate; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const isPlus = !!me.data?.isPlus;
  const singlePayer = t.payload.payers.length === 1;
  const [description, setDescription] = React.useState(t.description);
  const [amount, setAmount] = React.useState(minorToDecimalString(Number(t.amount_minor), t.currency));
  const [frequency, setFrequency] = React.useState<Frequency>(t.frequency);
  const [startDate, setStartDate] = React.useState(t.start_date);
  const [endDate, setEndDate] = React.useState(t.end_date ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scheduleChanged = frequency !== t.frequency || startDate !== t.start_date;

  const save = async () => {
    setError(null);
    const total = parseMoney(amount, t.currency);
    if (!total || total <= 0) return setError('Enter a valid amount.');
    if (!description.trim()) return setError('Add a description.');
    let payload = { ...t.payload, description: description.trim(), amount_minor: total, currency: t.currency, category_id: t.category_id, group_id: t.group_id };
    if (total !== Number(t.amount_minor)) {
      if (!singlePayer || t.payload.split_method === 'exact') return setError('To change the amount of a recurring expense with several payers or exact amounts, cancel it and create a new one.');
      try {
        const allocations = computeSplit({
          method: t.payload.split_method,
          totalMinor: total,
          participants: t.payload.participants.map((p) => ({ userId: p.user_id, included: p.included, value: p.value ?? undefined })),
        });
        payload = { ...payload, payers: [{ user_id: t.payload.payers[0]!.user_id, amount_minor: total }], splits: allocations.map((a) => ({ user_id: a.userId, amount_minor: a.amountMinor })) };
      } catch (e) {
        return setError(errorMessage(e));
      }
    }
    setBusy(true);
    try {
      unwrap(await supabase.rpc('update_recurring_template', { p_template_id: t.id, p_payload: payload, p_frequency: frequency, p_start_date: startDate, p_end_date: endDate || null }));
      toast.success('Recurring expense updated — future occurrences only');
      invalidateFinancial(qc);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Edit recurring expense" description="Changes apply to future occurrences. Expenses already created are not changed."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Description" htmlFor="rt-desc"><Input id="rt-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} /></Field>
        <Field label={`Amount (${t.currency})`} htmlFor="rt-amt" hint={singlePayer ? 'Shares are recalculated with the same split.' : 'Several payers — amount is fixed.'}>
          <Input id="rt-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!singlePayer} className="tabular" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="How often" htmlFor="rt-freq">
            <NativeSelect id="rt-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => <option key={f} value={f} disabled={!isPlus && (f === 'quarterly' || f === 'yearly')}>{FREQUENCY_LABELS[f]}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Ends on" htmlFor="rt-end" optional><Input id="rt-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
        {scheduleChanged || frequency !== t.frequency ? (
          <Field label="New schedule starts" htmlFor="rt-start" hint="Must be after the last created expense.">
            <Input id="rt-start" type="date" value={startDate} min={todayISO()} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
        ) : (
          <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setStartDate(todayISO())}>Restart schedule from a new date…</button>
        )}
        {error && <p role="alert" className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{error}</p>}
      </div>
    </Dialog>
  );
}
