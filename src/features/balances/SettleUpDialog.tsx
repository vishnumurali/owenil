import * as React from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { ArrowRight, Info } from 'lucide-react';
import { CURRENCIES, formatMoney, minorToDecimalString, parseMoney, settlementPayloadSchema } from '@owenil/core';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { newIdempotencyKey, todayISO } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { invalidateFinancial, useContacts, useFriends, useGroups, useUpiId } from '@/data/queries';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { UpiPayPanel } from '@/features/payments/UpiPayPanel';

export interface SettleDefaults {
  groupId?: string | null;
  payerId?: string;
  payeeId?: string;
  amountMinor?: number;
  currency?: string;
}

const METHODS = [
  { v: 'upi', label: 'UPI' },
  { v: 'cash', label: 'Cash' },
  { v: 'bank_transfer', label: 'Bank transfer' },
  { v: 'card', label: 'Card' },
  { v: 'other', label: 'Other' },
] as const;

export function SettleUpDialog({ open, onOpenChange, defaults }: { open: boolean; onOpenChange: (o: boolean) => void; defaults: SettleDefaults }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Record a repayment" description="Log money that changed hands outside Owenil.">
      {open && <SettleForm defaults={defaults} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function SettleForm({ defaults, onDone }: { defaults: SettleDefaults; onDone: () => void }) {
  const { user } = useAuth();
  const me = user!.id;
  const qc = useQueryClient();
  const groups = useGroups();
  const friends = useFriends();
  const contacts = useContacts();
  const idemKey = React.useMemo(() => newIdempotencyKey('settle'), []);

  const [groupId, setGroupId] = React.useState<string>(defaults.groupId ?? '');
  const [payerId, setPayerId] = React.useState(defaults.payerId ?? me);
  const [payeeId, setPayeeId] = React.useState(defaults.payeeId ?? '');
  const [currency, setCurrency] = React.useState(defaults.currency ?? 'INR');
  const [amount, setAmount] = React.useState(defaults.amountMinor ? minorToDecimalString(defaults.amountMinor, defaults.currency ?? 'INR') : '');
  const [date, setDate] = React.useState(todayISO());
  const [method, setMethod] = React.useState<(typeof METHODS)[number]['v']>('upi');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const group = groups.data?.find((g) => g.id === groupId);
  const people = React.useMemo(() => {
    if (group) return group.group_members.filter((m) => m.status === 'active').map((m) => m.user_id);
    return [me, ...(friends.data?.friendIds ?? [])];
  }, [group, friends.data, me]);
  const name = (id: string) => (id === me ? 'You' : contacts.data?.get(id)?.display_name ?? 'Someone');
  const other = payerId === me ? payeeId : payerId;
  // You're paying someone in INR: offer their UPI ID (if they shared one with you).
  const upiPayee = payerId === me && payeeId && currency === 'INR' ? payeeId : null;
  const upi = useUpiId(upiPayee);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amountMinor = parseMoney(amount, currency);
    const parsed = settlementPayloadSchema.safeParse({
      group_id: groupId || null,
      payer_id: payerId,
      payee_id: payeeId,
      amount_minor: amountMinor ?? 0,
      currency,
      settled_on: date,
      method,
      note: note.trim() || null,
    });
    if (!payeeId || !payerId) return setError('Choose who paid whom.');
    if (payerId !== me && payeeId !== me) return setError('You can only record repayments you were part of.');
    if (!amountMinor || amountMinor <= 0) return setError('Enter an amount greater than zero.');
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the details.');
    setBusy(true);
    try {
      unwrap(await supabase.rpc('record_settlement', { p_payload: parsed.data, p_idempotency_key: idemKey }));
      invalidateFinancial(qc);
      setDone(true);
      setTimeout(onDone, 1500);
    } catch (err) {
      setError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center py-8 text-center" role="status">
        <motion.svg viewBox="0 0 52 52" className="size-20" initial="hidden" animate="show">
          <motion.circle cx="26" cy="26" r="24" fill="none" stroke="hsl(var(--positive))" strokeWidth="3"
            variants={{ hidden: { pathLength: 0 }, show: { pathLength: 1, transition: { duration: 0.5 } } }} />
          <motion.path d="M15 27 l7 7 l15 -16" fill="none" stroke="hsl(var(--positive))" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
            variants={{ hidden: { pathLength: 0 }, show: { pathLength: 1, transition: { delay: 0.4, duration: 0.35 } } }} />
        </motion.svg>
        {[...Array(10)].map((_, i) => (
          <motion.span key={i} className="pointer-events-none absolute size-2 rounded-full"
            style={{ background: i % 2 ? 'hsl(var(--primary))' : 'hsl(var(--accent))', top: '35%', left: '50%' }}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={{ x: Math.cos((i / 10) * Math.PI * 2) * 90, y: Math.sin((i / 10) * Math.PI * 2) * 70, opacity: 0 }}
            transition={{ duration: 0.9, delay: 0.45, ease: 'easeOut' }} />
        ))}
        <p className="mt-4 text-lg font-semibold">Repayment recorded</p>
        <p className="mt-1 max-w-xs text-sm text-fg-muted">Balances are updated. Owenil only keeps the record — no money was moved by the app.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Where" htmlFor="settle-group" hint={group ? 'Applies to this group’s balance.' : 'Applies to expenses outside groups.'}>
        <NativeSelect id="settle-group" value={groupId} onChange={(e) => setGroupId(e.target.value)} disabled={defaults.groupId !== undefined && defaults.groupId !== null}>
          <option value="">Between friends (no group)</option>
          {groups.data?.filter((g) => !g.archived_at).map((g) => (
            <option key={g.id} value={g.id}>
              {g.emoji} {g.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <Field label="Paid by" htmlFor="settle-payer">
          <NativeSelect id="settle-payer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
            {people.map((p) => (
              <option key={p} value={p}>
                {name(p)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <ArrowRight className="mb-3 size-4 text-fg-subtle" aria-hidden />
        <Field label="Paid to" htmlFor="settle-payee">
          <NativeSelect id="settle-payee" value={payeeId} onChange={(e) => setPayeeId(e.target.value)}>
            <option value="">Choose…</option>
            {people.filter((p) => p !== payerId).map((p) => (
              <option key={p} value={p}>
                {name(p)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {other && (
        <div className="flex items-center gap-3 rounded-xl bg-fg/[0.04] p-3 text-sm">
          <Avatar name={contacts.data?.get(payerId)?.display_name ?? 'You'} color={contacts.data?.get(payerId)?.avatar_color} size="sm" />
          <span className="flex-1">
            <strong>{name(payerId)}</strong> paid <strong>{name(payeeId || other)}</strong>
            {parseMoney(amount, currency) ? <> {formatMoney(parseMoney(amount, currency)!, currency)}</> : null}
          </span>
        </div>
      )}

      <div className="grid grid-cols-[1fr_110px] gap-2">
        <Field label="Amount" htmlFor="settle-amount">
          <Input id="settle-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="tabular text-lg font-semibold" />
        </Field>
        <Field label="Currency" htmlFor="settle-currency">
          <NativeSelect id="settle-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {upiPayee && upi.data && (
        <UpiPayPanel upiId={upi.data} payeeName={name(upiPayee)} amountMinor={parseMoney(amount, currency)}
          note={`Owenil - ${group?.name ?? 'settle up'}`} />
      )}
      {upiPayee && upi.data === null && (
        <p className="text-xs text-fg-subtle">
          {name(upiPayee)} hasn’t shared a UPI ID. They can add one in Settings to get paid back in one tap.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date" htmlFor="settle-date">
          <Input id="settle-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Method" htmlFor="settle-method">
          <NativeSelect id="settle-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            {METHODS.map((m) => (
              <option key={m.v} value={m.v}>
                {m.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Note" htmlFor="settle-note" optional>
        <Textarea id="settle-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. UPI ref 4821" />
      </Field>
      <p className="flex items-start gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-xs text-accent">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        Recording a repayment does not transfer money. Pay through your bank or UPI app first, then record it here.
      </p>
      {error && (
        <p role="alert" className="rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" size="lg" loading={busy}>
        Record repayment
      </Button>
    </form>
  );
}

