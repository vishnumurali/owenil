import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, CalendarClock, Check, FileImage, Lock, Plus, Save, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  CURRENCIES, FREQUENCY_LABELS, equalPayers, formatMoney, minorToDecimalString, parseMoney, trySplit, unitsToPercentString,
  validatePayers, type Frequency, type SplitMethod,
} from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, toAppError, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { cn, newIdempotencyKey, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  invalidateFinancial, qk, useCategories, useContacts, useExpense, useFriends, useGroups, useMe, useSplitTemplates,
} from '@/data/queries';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Badge, Skeleton, Switch } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { Avatar } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/layout-bits';
import { CategoryIcon, PlusBadge } from '@/components/domain';
import { SplitEditor, draftToInputs, type SplitDraft } from './SplitEditor';
import { uploadReceipt, validateReceiptFile } from './receipts';

function valueToString(method: SplitMethod, v: number | null, currency: string): string {
  if (v === null || v === undefined) return '';
  if (method === 'exact' || method === 'adjustment') return minorToDecimalString(Number(v), currency);
  if (method === 'percentage') return unitsToPercentString(Number(v));
  if (method === 'shares') return (Number(v) / 100).toString();
  return '';
}

export default function ExpenseFormPage() {
  const { expenseId } = useParams();
  const [params] = useSearchParams();
  const editing = !!expenseId;
  const duplicateId = params.get('duplicate');
  useDocumentTitle(editing ? 'Edit expense' : 'Add expense');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const me = user!.id;
  const meQ = useMe();
  const isPlus = !!meQ.data?.isPlus;
  const groups = useGroups();
  const friends = useFriends();
  const contacts = useContacts();
  const categories = useCategories();
  const templates = useSplitTemplates();
  const source = useExpense(expenseId ?? duplicateId ?? undefined);

  const [idemKey, setIdemKey] = React.useState(() => newIdempotencyKey('exp'));
  const [description, setDescription] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [currency, setCurrency] = React.useState('INR');
  const [date, setDate] = React.useState(todayISO());
  const [categoryId, setCategoryId] = React.useState('');
  const [groupId, setGroupId] = React.useState(params.get('group') ?? '');
  const [friendIds, setFriendIds] = React.useState<string[]>(params.get('friend') ? [params.get('friend')!] : []);
  const [notes, setNotes] = React.useState('');
  const [tags, setTags] = React.useState('');
  const [payerMode, setPayerMode] = React.useState<'single' | 'multiple'>('single');
  const [payer, setPayer] = React.useState(me);
  const [payerAmounts, setPayerAmounts] = React.useState<Record<string, string>>({});
  const [draft, setDraft] = React.useState<SplitDraft>({ method: 'equal', included: {}, values: {}, items: [] });
  const [repeat, setRepeat] = React.useState(params.get('repeat') === '1');
  const [frequency, setFrequency] = React.useState<Frequency>('monthly');
  const [endDate, setEndDate] = React.useState('');
  const [receiptFile, setReceiptFile] = React.useState<File | null>(null);
  const [merchant, setMerchant] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [showErrors, setShowErrors] = React.useState(false);
  const [templateOpen, setTemplateOpen] = React.useState(false);
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [version, setVersion] = React.useState(1);
  const initialised = React.useRef(false);

  const group = groups.data?.find((g) => g.id === groupId);
  const people = React.useMemo(() => {
    if (group) return group.group_members.filter((m) => m.status === 'active').map((m) => m.user_id);
    return [me, ...friendIds.filter((f) => f !== me)];
  }, [group, friendIds, me]);

  // ----- Initialise from an existing expense (edit / duplicate) or defaults -----
  React.useEffect(() => {
    if (initialised.current) return;
    if (editing || duplicateId) {
      if (!source.data) return;
      const e = source.data;
      initialised.current = true;
      setDescription(e.description);
      setAmount(minorToDecimalString(Number(e.amount_minor), e.currency));
      setCurrency(e.currency);
      setDate(editing ? e.expense_date : todayISO());
      setCategoryId(e.category_id ?? '');
      setGroupId(e.group_id ?? '');
      setNotes(e.notes ?? '');
      setTags((e.tags ?? []).join(', '));
      setVersion(e.version);
      const parts = e.expense_participants ?? [];
      if (!e.group_id) setFriendIds(parts.map((p) => p.user_id).concat((e.expense_payers ?? []).map((p) => p.user_id)).filter((v, i, a) => v !== me && a.indexOf(v) === i));
      const payersRows = e.expense_payers ?? [];
      if (payersRows.length === 1) {
        setPayerMode('single');
        setPayer(payersRows[0]!.user_id);
      } else {
        setPayerMode('multiple');
        setPayerAmounts(Object.fromEntries(payersRows.map((p) => [p.user_id, minorToDecimalString(Number(p.amount_minor), e.currency)])));
      }
      const method = e.split_method === 'itemized' && !isPlus && !editing ? 'equal' : e.split_method;
      setDraft({
        method,
        included: Object.fromEntries(parts.map((p) => [p.user_id, p.included])),
        values: Object.fromEntries(parts.map((p) => [p.user_id, valueToString(method, p.input_value, e.currency)])),
        items: (e.expense_items ?? []).map((i) => ({
          key: i.id,
          name: i.name,
          amount: minorToDecimalString(Number(i.amount_minor), e.currency),
          kind: i.kind,
          assignees: (i.expense_item_assignments ?? []).map((a) => a.user_id),
        })),
      });
    } else if (meQ.data && groups.data) {
      initialised.current = true;
      const g = groups.data.find((x) => x.id === groupId);
      setCurrency(g?.default_currency ?? meQ.data.profile.default_currency);
      if (g?.default_split) applyPreset(g.default_split.method, g.default_split.participants, g.default_currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.data, meQ.data, groups.data]);

  function applyPreset(method: SplitMethod, parts: { user_id: string; value: number | null }[], cur = currency) {
    setDraft({
      method,
      included: Object.fromEntries(people.map((p) => [p, parts.length ? parts.some((x) => x.user_id === p) : true])),
      values: Object.fromEntries(parts.map((p) => [p.user_id, valueToString(method, p.value, cur)])),
      items: [],
    });
  }

  const changeGroup = (id: string) => {
    setGroupId(id);
    const g = groups.data?.find((x) => x.id === id);
    setPayer(me);
    setPayerAmounts({});
    setDraft({ method: 'equal', included: {}, values: {}, items: [] });
    if (g) {
      setCurrency(g.default_currency);
      if (g.default_split) {
        const members = g.group_members.filter((m) => m.status === 'active').map((m) => m.user_id);
        setDraft({
          method: g.default_split.method,
          included: Object.fromEntries(members.map((p) => [p, g.default_split!.participants.some((x) => x.user_id === p)])),
          values: Object.fromEntries(g.default_split.participants.map((p) => [p.user_id, valueToString(g.default_split!.method, p.value, g.default_currency)])),
          items: [],
        });
      }
    }
  };

  // ----- Derived calculation (pure core engine) -----
  const totalMinor = parseMoney(amount, currency);
  const payers = React.useMemo(() => {
    if (!totalMinor || totalMinor <= 0) return [];
    if (payerMode === 'single') return [{ userId: payer, amountMinor: totalMinor }];
    return people.map((p) => ({ userId: p, amountMinor: parseMoney(payerAmounts[p] || '0', currency) ?? -1 })).filter((p) => p.amountMinor !== 0);
  }, [payerMode, payer, totalMinor, people, payerAmounts, currency]);
  const payerCheck = totalMinor ? validatePayers(totalMinor, payers) : null;
  const inputs = draftToInputs(draft, people, currency);
  const split = totalMinor && totalMinor > 0 && !inputs.error ? trySplit({ method: draft.method, totalMinor, participants: inputs.participants, items: inputs.items }) : null;
  const allocations = split?.ok ? split.allocations : null;

  const descriptionError = !description.trim() ? 'Add a description' : undefined;
  const amountError = !amount ? 'Enter an amount' : !totalMinor || totalMinor <= 0 ? `Enter a valid amount in ${currency}` : undefined;
  const peopleError = !group && friendIds.length === 0 ? 'Choose at least one friend, or pick a group' : undefined;
  const canSubmit = !descriptionError && !amountError && !peopleError && !!allocations && payerCheck?.ok;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    setFormError(null);
    if (!canSubmit || !allocations || !totalMinor) {
      setFormError(descriptionError ?? amountError ?? peopleError ?? (payerCheck && !payerCheck.ok ? payerCheck.message : null) ?? inputs.error ?? (split && !split.ok ? split.error.message : 'Check the split.'));
      return;
    }
    setSubmitting(true);
    try {
      let receiptId: string | null = editing ? source.data?.receipt_id ?? null : null;
      if (receiptFile || merchant.trim()) {
        receiptId = await uploadReceipt(me, receiptFile, { merchant: merchant.trim() || null, receipt_date: date, currency, total_minor: totalMinor });
      }
      const allocated = new Set(allocations.map((a) => a.userId));
      const payload = {
        group_id: groupId || null,
        description: description.trim(),
        amount_minor: totalMinor,
        currency,
        expense_date: date,
        category_id: categoryId || null,
        notes: notes.trim() || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
        split_method: draft.method,
        payers: payers.map((p) => ({ user_id: p.userId, amount_minor: p.amountMinor })),
        participants: inputs.participants.map((p) => ({
          user_id: p.userId,
          included: draft.method === 'itemized' ? allocated.has(p.userId) : p.included !== false,
          value: draft.method === 'equal' || draft.method === 'itemized' ? null : p.value ?? 0,
        })),
        splits: allocations.map((a) => ({ user_id: a.userId, amount_minor: a.amountMinor })),
        items: (inputs.items ?? []).map((i) => ({ name: i.name, amount_minor: i.amountMinor, kind: i.kind ?? 'item', assignees: i.assignees.map((a) => ({ user_id: a.userId, weight: a.weight ?? 1 })) })),
        receipt_id: receiptId,
      };
      let targetId: string | null = null;
      if (editing) {
        const r = unwrap(await supabase.rpc('update_expense', { p_expense_id: expenseId, p_expected_version: version, p_payload: payload, p_idempotency_key: idemKey })) as { expense_id: string };
        targetId = r.expense_id;
        toast.success('Expense updated');
      } else if (repeat) {
        unwrap(await supabase.rpc('create_recurring_template', { p_payload: payload, p_frequency: frequency, p_start_date: date, p_end_date: endDate || null }));
        toast.success(date <= todayISO() ? 'Recurring expense created — the first one is added' : 'Recurring expense scheduled');
      } else {
        const r = unwrap(await supabase.rpc('create_expense', { p_payload: payload, p_idempotency_key: idemKey })) as { expense_id: string };
        targetId = r.expense_id;
        toast.success('Expense added');
      }
      invalidateFinancial(qc);
      navigate(targetId ? `/expenses/${targetId}` : '/recurring', { replace: true });
    } catch (err) {
      const ae = toAppError(err);
      setFormError(ae.message);
      if (ae.code !== 'NETWORK') setIdemKey(newIdempotencyKey('exp'));
      if (ae.code === 'VERSION_CONFLICT') void qc.invalidateQueries({ queryKey: qk.expense(expenseId!) });
    } finally {
      setSubmitting(false);
    }
  };

  if ((editing || duplicateId) && source.isLoading) return <Skeleton className="h-[600px] rounded-2xl" />;
  if (editing && !source.data) return <Card><EmptyState illustration="error" title="Expense not found" action={<Button asChild variant="outline"><Link to="/expenses">All expenses</Link></Button>} /></Card>;
  if (editing && source.data?.deleted_at) return <Card><EmptyState illustration="expenses" title="This expense is deleted" description="Restore it before editing." action={<Button asChild><Link to={`/expenses/${expenseId}`}>Open expense</Link></Button>} /></Card>;

  const name = (id: string) => (id === me ? 'You' : contacts.data?.get(id)?.display_name ?? 'Member');
  const activeGroups = (groups.data ?? []).filter((g) => !g.archived_at);
  const relevantTemplates = (templates.data ?? []).filter((t) => (t.group_id ?? '') === groupId);
  const isGroupAdmin = group?.group_members.some((m) => m.user_id === me && m.status === 'active' && (m.role === 'owner' || m.role === 'admin'));

  return (
    <form onSubmit={submit} className="mx-auto max-w-5xl" noValidate>
      <button type="button" onClick={() => (editing ? navigate(`/expenses/${expenseId}`) : navigate(-1))} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back
      </button>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">{editing ? 'Edit expense' : duplicateId ? 'Duplicate expense' : 'Add an expense'}</h1>
        {editing && <Badge>Version {version}</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card className="space-y-5 p-5 sm:p-6">
            {!editing && (
              <Field label="With" htmlFor="group">
                <NativeSelect id="group" value={groupId} onChange={(e) => changeGroup(e.target.value)}>
                  <option value="">Friends (no group)</option>
                  {activeGroups.map((g) => (
                    <option key={g.id} value={g.id}>{g.emoji} {g.name}</option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {!group && (
              <Field label="Friends in this expense" error={showErrors ? peopleError : undefined}>
                <div className="flex flex-wrap gap-2">
                  {(friends.data?.friendIds ?? []).length === 0 && <p className="text-sm text-fg-muted">No friends yet. <Link to="/friends" className="text-primary hover:underline">Invite one</Link> or choose a group.</p>}
                  {(friends.data?.friendIds ?? []).map((f) => {
                    const on = friendIds.includes(f);
                    return (
                      <button key={f} type="button" aria-pressed={on} disabled={editing && on && (source.data?.expense_payers ?? []).some((p) => p.user_id === f)}
                        onClick={() => setFriendIds((ids) => (on ? ids.filter((x) => x !== f) : [...ids, f]))}
                        className={cn('inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-all', on ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-fg/[0.05]')}>
                        <Avatar name={contacts.data?.get(f)?.display_name ?? '?'} color={contacts.data?.get(f)?.avatar_color} size="xs" />
                        {contacts.data?.get(f)?.display_name ?? 'Friend'}
                        {on && <Check className="size-3.5" />}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            <Field label="Description" htmlFor="description" error={showErrors ? descriptionError : undefined}>
              <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Dinner at Fisherman’s Wharf" maxLength={140} autoFocus={!editing} aria-invalid={showErrors && !!descriptionError} />
            </Field>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field label="Amount" htmlFor="amount" error={showErrors ? amountError : undefined}>
                <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-12 text-xl font-semibold tabular" aria-invalid={showErrors && !!amountError} />
              </Field>
              <Field label="Currency" htmlFor="currency">
                <NativeSelect id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-12">
                  {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
                </NativeSelect>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date" htmlFor="date">
                <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Category" htmlFor="category">
                <div className="flex gap-2">
                  <NativeSelect id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Uncategorised</option>
                    {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_system ? '' : ' (custom)'}</option>)}
                  </NativeSelect>
                  <Button type="button" variant="outline" size="icon" aria-label="New category" onClick={() => setCategoryOpen(true)}><Plus /></Button>
                </div>
              </Field>
            </div>
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Paid by</h2>
              <Segmented size="sm" value={payerMode} onChange={setPayerMode} ariaLabel="Payer mode" options={[{ value: 'single', label: 'One person' }, { value: 'multiple', label: 'Several people' }]} />
            </div>
            {payerMode === 'single' ? (
              <div className="flex flex-wrap gap-2">
                {people.map((p) => (
                  <button key={p} type="button" aria-pressed={payer === p} onClick={() => setPayer(p)}
                    className={cn('inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-all', payer === p ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-fg/[0.05]')}>
                    <Avatar name={contacts.data?.get(p)?.display_name ?? '?'} color={contacts.data?.get(p)?.avatar_color} size="xs" />
                    {name(p)}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {people.map((p) => (
                  <div key={p} className="flex items-center gap-3">
                    <Avatar name={contacts.data?.get(p)?.display_name ?? '?'} color={contacts.data?.get(p)?.avatar_color} size="sm" />
                    <span className="flex-1 text-sm">{name(p)}</span>
                    <Input inputMode="decimal" value={payerAmounts[p] ?? ''} onChange={(e) => setPayerAmounts({ ...payerAmounts, [p]: e.target.value })} placeholder="0.00" className="h-9 w-32 text-right tabular" aria-label={`Amount paid by ${name(p)}`} />
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1">
                  <Button type="button" size="sm" variant="ghost" disabled={!totalMinor}
                    onClick={() => totalMinor && setPayerAmounts(Object.fromEntries(equalPayers(totalMinor, people).map((p) => [p.userId, minorToDecimalString(p.amountMinor, currency)])))}>
                    <Users /> Split payment equally
                  </Button>
                  {payerCheck && !payerCheck.ok && totalMinor ? (
                    <span className="text-xs font-medium text-warning">
                      {payerCheck.difference !== undefined ? `${formatMoney(Math.abs(payerCheck.difference), currency)} ${payerCheck.difference > 0 ? 'left to assign' : 'too much'}` : payerCheck.message}
                    </span>
                  ) : totalMinor ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-positive"><Check className="size-3.5" /> Matches total</span>
                  ) : null}
                </div>
              </div>
            )}
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Split</h2>
              <div className="flex gap-1.5">
                {relevantTemplates.length > 0 && (
                  <NativeSelect aria-label="Apply a saved preset" value="" onChange={(e) => { const t = relevantTemplates.find((x) => x.id === e.target.value); if (t) applyPreset(t.split_method, t.participants); }} className="h-8 text-xs">
                    <option value="">Apply preset…</option>
                    {relevantTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </NativeSelect>
                )}
                <Button type="button" size="sm" variant="ghost" onClick={() => setTemplateOpen(true)} disabled={draft.method === 'itemized'}>
                  <Save /> Save split
                </Button>
              </div>
            </div>
            <SplitEditor
              people={people}
              currency={currency}
              totalMinor={totalMinor && totalMinor > 0 ? totalMinor : null}
              draft={draft}
              onChange={setDraft}
              allocations={allocations}
              splitError={split && !split.ok ? split.error : null}
              inputError={inputs.error}
              payers={payers}
              isPlus={isPlus || (editing && source.data?.split_method === 'itemized')}
            />
          </Card>

          <Card className="space-y-4 p-5 sm:p-6">
            <h2 className="font-semibold">More details</h2>
            <Field label="Notes" htmlFor="notes" optional>
              <Textarea id="notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Field label="Tags" htmlFor="tags" optional hint="Separate with commas, e.g. weekend, office">
              <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
            <div className="rounded-xl border border-dashed border-fg/15 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-medium"><FileImage className="size-4 text-fg-subtle" /> Receipt</p>
                <PlusBadge />
              </div>
              {isPlus ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Image or PDF" htmlFor="receipt" optional hint="Private — only people on this expense can see it. Max 5 MB.">
                    <Input id="receipt" type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" capture="environment"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        if (f) {
                          const err = validateReceiptFile(f);
                          if (err) {
                            toast.error(err);
                            e.target.value = '';
                            return;
                          }
                        }
                        setReceiptFile(f);
                      }} className="pt-1.5" />
                  </Field>
                  <Field label="Merchant" htmlFor="merchant" optional>
                    <Input id="merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={120} />
                  </Field>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-fg-muted"><Lock className="size-4" /> Attach receipts and itemise them with <Link to="/plus" className="font-medium text-plus hover:underline">Owenil Plus</Link>.</p>
              )}
            </div>
            {!editing && (
              <div className="rounded-xl bg-fg/[0.04] p-4">
                <label className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium"><CalendarClock className="size-4 text-accent" /> Repeat this expense</span>
                  <Switch checked={repeat} onCheckedChange={setRepeat} aria-label="Repeat this expense" disabled={draft.method === 'itemized'} />
                </label>
                {repeat && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="How often" htmlFor="freq">
                      <NativeSelect id="freq" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                        {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
                          <option key={f} value={f} disabled={!isPlus && (f === 'quarterly' || f === 'yearly')}>
                            {FREQUENCY_LABELS[f]}{!isPlus && (f === 'quarterly' || f === 'yearly') ? ' (Plus)' : ''}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Field label="Ends on" htmlFor="end" optional>
                      <Input id="end" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
                    </Field>
                    <p className="text-xs text-fg-muted sm:col-span-2">Starts on {date}. New expenses are created automatically on the server — your browser doesn’t need to be open.</p>
                  </motion.div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* ---------- Live summary ---------- */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card className="overflow-hidden">
            <div className="bg-brand-gradient p-5 text-white">
              <p className="text-sm text-white/80">{description.trim() || 'New expense'}</p>
              <p className="mt-1 font-display text-3xl font-semibold tabular">{totalMinor && totalMinor > 0 ? formatMoney(totalMinor, currency) : formatMoney(0, currency)}</p>
              <p className="mt-1 text-xs text-white/80">{group ? `${group.emoji} ${group.name}` : 'Between friends'} · {date}</p>
            </div>
            <div className="p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Each person’s share</p>
              {allocations ? (
                <ul className="space-y-2.5">
                  {allocations.map((a) => {
                    const paid = payers.find((p) => p.userId === a.userId)?.amountMinor ?? 0;
                    const net = paid - a.amountMinor;
                    return (
                      <li key={a.userId} className="flex items-center gap-2.5 text-sm">
                        <Avatar name={contacts.data?.get(a.userId)?.display_name ?? '?'} color={contacts.data?.get(a.userId)?.avatar_color} size="xs" />
                        <span className="min-w-0 flex-1 truncate">{name(a.userId)}</span>
                        <span className="tabular font-semibold">{formatMoney(a.amountMinor, currency)}</span>
                        <span className={cn('tabular w-20 text-right text-xs', net > 0 ? 'text-positive' : net < 0 ? 'text-negative' : 'text-fg-subtle')}>
                          {net === 0 ? 'even' : formatMoney(net, currency, { signDisplay: 'always' })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm text-fg-subtle">Enter an amount and choose a split to see everyone’s share.</p>
              )}
              {allocations && <p className="mt-3 text-2xs text-fg-subtle">Shares add up exactly to the total. + means others owe them; − means they owe.</p>}
              {categoryId && (
                <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-sm">
                  <CategoryIcon category={categories.data?.find((c) => c.id === categoryId)} size="sm" />
                  {categories.data?.find((c) => c.id === categoryId)?.name}
                </div>
              )}
              {formError && <p role="alert" className="mt-4 rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{formError}</p>}
              <Button type="submit" size="lg" className="mt-5 hidden w-full lg:inline-flex" loading={submitting}>
                {editing ? 'Save changes' : repeat ? 'Create recurring expense' : 'Add expense'}
              </Button>
              {isGroupAdmin && draft.method !== 'itemized' && (
                <Button type="button" variant="ghost" size="sm" className="mt-2 w-full"
                  onClick={async () => {
                    const { error } = await supabase.from('groups').update({
                      default_split: { method: draft.method, participants: inputs.participants.filter((p) => p.included !== false).map((p) => ({ user_id: p.userId, value: p.value ?? null })) },
                    }).eq('id', groupId);
                    if (error) toast.error(errorMessage(error));
                    else {
                      toast.success('Saved as this group’s default split');
                      void qc.invalidateQueries({ queryKey: qk.groups });
                    }
                  }}>
                  Make this the group’s default split
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      <SaveTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} isPlus={isPlus} groupId={groupId || null}
        method={draft.method} participants={inputs.participants.filter((p) => p.included !== false).map((p) => ({ user_id: p.userId, value: p.value ?? null }))} />
      <NewCategoryDialog open={categoryOpen} onOpenChange={setCategoryOpen} onCreated={(id) => setCategoryId(id)} />
      {/* Phones: the total and the button stay at the bottom of the screen while the form scrolls. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-border/60 bg-canvas/95 px-4 py-3 backdrop-blur safe-bottom sm:-mx-6 sm:px-6 lg:hidden">
        {formError && <p role="alert" className="mb-2 rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">{formError}</p>}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-2xs text-fg-muted">{description.trim() || 'New expense'}</p>
            <p className="truncate font-display text-lg font-semibold tabular">{formatMoney(totalMinor && totalMinor > 0 ? totalMinor : 0, currency)}</p>
          </div>
          <Button type="submit" size="lg" loading={submitting}>
            {editing ? 'Save changes' : repeat ? 'Create recurring expense' : 'Add expense'}
          </Button>
        </div>
      </div>
    </form>
  );
}

function SaveTemplateDialog({ open, onOpenChange, isPlus, groupId, method, participants }: {
  open: boolean; onOpenChange: (o: boolean) => void; isPlus: boolean; groupId: string | null; method: SplitMethod; participants: { user_id: string; value: number | null }[];
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Save split as a preset" description="Reuse this split for future expenses.">
      {!isPlus ? (
        <div className="space-y-3 text-sm text-fg-muted">
          <p>Saved split presets are part of Owenil Plus. Group admins can still save a group default split for free.</p>
          <Button asChild variant="plus"><Link to="/plus"><Sparkles /> See Plus</Link></Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          const { error } = await supabase.from('split_templates').insert({ owner_id: user!.id, group_id: groupId, name: name.trim(), split_method: method, participants });
          setBusy(false);
          if (error) toast.error(errorMessage(error));
          else {
            toast.success('Preset saved');
            void qc.invalidateQueries({ queryKey: qk.splitTemplates });
            onOpenChange(false);
            setName('');
          }
        }}>
          <Field label="Preset name" htmlFor="tpl-name"><Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Rent 60/40" autoFocus /></Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!name.trim()}>Save preset</Button>
        </form>
      )}
    </Dialog>
  );
}

function NewCategoryDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New category" size="sm">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        const { data, error } = await supabase.from('categories').insert({ owner_id: user!.id, name: name.trim(), slug: 'custom', icon: 'tag', color: '#64748b' }).select('id').single();
        setBusy(false);
        if (error) toast.error(errorMessage(error));
        else {
          void qc.invalidateQueries({ queryKey: qk.categories });
          onCreated((data as { id: string }).id);
          onOpenChange(false);
          setName('');
        }
      }}>
        <Field label="Name" htmlFor="cat-name"><Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus /></Field>
        <Button type="submit" className="w-full" loading={busy} disabled={!name.trim()}>Create category</Button>
      </form>
    </Dialog>
  );
}
