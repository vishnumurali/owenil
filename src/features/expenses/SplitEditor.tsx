import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  formatMoney, minorUnitsOf, parseMoney, percentToUnits, weightToUnits, SPLIT_METHOD_LABELS,
  type Allocation, type ItemInput, type ParticipantInput, type SplitError, type SplitMethod,
} from '@owenil/core';
import { cn } from '@/lib/utils';
import { useContacts } from '@/data/queries';
import { useAuth } from '@/features/auth/AuthProvider';
import { Avatar } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/misc';
import { Input, NativeSelect } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export interface ItemDraft {
  key: string;
  name: string;
  amount: string;
  kind: 'item' | 'tax' | 'tip' | 'discount';
  assignees: string[];
}

export interface SplitDraft {
  method: SplitMethod;
  included: Record<string, boolean>;
  values: Record<string, string>;
  items: ItemDraft[];
}

export const METHOD_ORDER: SplitMethod[] = ['equal', 'exact', 'percentage', 'shares', 'adjustment', 'itemized'];
const METHOD_HINT: Record<SplitMethod, string> = {
  equal: 'Everyone selected pays the same. Any leftover paisa goes to a fixed person so totals always match.',
  exact: 'Type exactly what each person owes. The amounts must add up to the total.',
  percentage: 'Give each person a percentage. They must add up to 100%.',
  shares: 'Split by weights — e.g. 2 for a couple, 1 for a single person. Decimals allowed.',
  adjustment: 'Split equally, then add or subtract an amount for anyone who had more or less.',
  itemized: 'Assign receipt items to people. Tax, tip and discounts are shared in proportion to items.',
};

/** Converts the editable draft into engine inputs. Returns an error message for unparsable fields. */
export function draftToInputs(draft: SplitDraft, people: string[], currency: string): { participants: ParticipantInput[]; items?: ItemInput[]; error?: string } {
  const participants: ParticipantInput[] = [];
  for (const userId of people) {
    const included = draft.included[userId] !== false;
    const raw = (draft.values[userId] ?? '').trim();
    let value: number | undefined;
    if (included && draft.method !== 'equal' && draft.method !== 'itemized') {
      if (draft.method === 'exact') value = raw === '' ? 0 : parseMoney(raw, currency) ?? NaN;
      else if (draft.method === 'adjustment') value = raw === '' ? 0 : parseMoney(raw, currency) ?? NaN;
      else if (draft.method === 'percentage') value = raw === '' ? 0 : percentToUnits(raw) ?? NaN;
      else if (draft.method === 'shares') value = raw === '' ? 0 : weightToUnits(raw) ?? NaN;
      if (value !== undefined && Number.isNaN(value)) return { participants: [], error: 'One of the values isn’t a valid number.' };
    }
    participants.push({ userId, included, value });
  }
  if (draft.method !== 'itemized') return { participants };
  const items: ItemInput[] = [];
  for (const it of draft.items) {
    const amt = parseMoney(it.amount || '0', currency);
    if (amt === null || amt < 0) return { participants, error: `“${it.name || 'Item'}” has an invalid amount.` };
    if (it.kind === 'item' && !it.name.trim()) return { participants, error: 'Give every item a name.' };
    items.push({ name: it.name.trim() || it.kind, amountMinor: amt, kind: it.kind, assignees: it.kind === 'item' ? it.assignees.map((u) => ({ userId: u })) : [] });
  }
  return { participants: participants.map((p) => ({ ...p, included: true })), items };
}

interface Props {
  people: string[];
  currency: string;
  totalMinor: number | null;
  draft: SplitDraft;
  onChange: (d: SplitDraft) => void;
  allocations: Allocation[] | null;
  splitError: SplitError | null;
  inputError?: string;
  payers: { userId: string; amountMinor: number }[];
  isPlus: boolean;
}

export function SplitEditor({ people, currency, totalMinor, draft, onChange, allocations, splitError, inputError, payers, isPlus }: Props) {
  const { data: contacts } = useContacts();
  const { user } = useAuth();
  const name = (id: string) => (id === user?.id ? 'You' : contacts?.get(id)?.display_name ?? 'Member');
  const allocMap = new Map((allocations ?? []).map((a) => [a.userId, a.amountMinor]));
  const paidMap = new Map(payers.map((p) => [p.userId, p.amountMinor]));
  const set = (patch: Partial<SplitDraft>) => onChange({ ...draft, ...patch });
  const decimals = minorUnitsOf(currency);

  const fillEvenly = () => {
    const included = people.filter((p) => draft.included[p] !== false);
    if (!included.length) return;
    const values: Record<string, string> = {};
    if (draft.method === 'percentage') {
      const base = Math.floor(10000 / included.length);
      included.forEach((p, i) => (values[p] = ((base + (i < 10000 - base * included.length ? 1 : 0)) / 100).toString()));
    } else if (draft.method === 'shares') included.forEach((p) => (values[p] = '1'));
    else if (draft.method === 'exact' && totalMinor) {
      const base = Math.floor(totalMinor / included.length);
      included.forEach((p, i) => (values[p] = ((base + (i < totalMinor - base * included.length ? 1 : 0)) / 10 ** decimals).toFixed(decimals)));
    } else if (draft.method === 'adjustment') included.forEach((p) => (values[p] = ''));
    set({ values });
  };

  const sumInfo = (() => {
    if (draft.method === 'percentage') {
      const s = people.filter((p) => draft.included[p] !== false).reduce((a, p) => a + (percentToUnits(draft.values[p] || '0') ?? 0), 0);
      return { label: `${(s / 100).toFixed(2).replace(/\.00$/, '')}% of 100%`, ok: s === 10000 };
    }
    if (draft.method === 'exact' && totalMinor) {
      const s = people.filter((p) => draft.included[p] !== false).reduce((a, p) => a + (parseMoney(draft.values[p] || '0', currency) ?? 0), 0);
      return { label: `${formatMoney(s, currency)} of ${formatMoney(totalMinor, currency)}`, ok: s === totalMinor };
    }
    if (draft.method === 'itemized' && totalMinor) {
      const s = draft.items.reduce((a, it) => a + (it.kind === 'discount' ? -1 : 1) * (parseMoney(it.amount || '0', currency) ?? 0), 0);
      return { label: `Receipt ${formatMoney(s, currency)} of ${formatMoney(totalMinor, currency)}`, ok: s === totalMinor };
    }
    return null;
  })();

  return (
    <div className="space-y-4">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin" role="radiogroup" aria-label="Split method">
        {METHOD_ORDER.map((m) => {
          const locked = m === 'itemized' && !isPlus;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={draft.method === m}
              disabled={locked}
              onClick={() => set({ method: m, values: {} })}
              title={locked ? 'Itemized splitting is an Owenil Plus feature' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                draft.method === m ? 'border-primary bg-primary text-primary-fg shadow-sm' : 'border-border text-fg-muted hover:bg-muted hover:text-fg',
                locked && 'cursor-not-allowed opacity-50',
              )}
            >
              {SPLIT_METHOD_LABELS[m]}
              {m === 'itemized' && <Sparkles className="size-3.5 text-plus" />}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-fg-muted">{METHOD_HINT[draft.method]}</p>

      {draft.method === 'itemized' ? (
        <ItemsEditor people={people} name={name} currency={currency} items={draft.items} onChange={(items) => set({ items })} />
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {people.map((p) => {
            const included = draft.included[p] !== false;
            const alloc = allocMap.get(p);
            const paid = paidMap.get(p) ?? 0;
            return (
              <div key={p} className={cn('flex items-center gap-3 px-3 py-2.5 transition-opacity', !included && 'opacity-50')}>
                <Checkbox
                  checked={included}
                  onCheckedChange={(v) => set({ included: { ...draft.included, [p]: v === true } })}
                  aria-label={`Include ${name(p)}`}
                />
                <Avatar name={contacts?.get(p)?.display_name ?? '?'} color={contacts?.get(p)?.avatar_color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name(p)}</p>
                  {paid > 0 && <p className="text-2xs text-fg-subtle">paid {formatMoney(paid, currency)}</p>}
                </div>
                {included && draft.method !== 'equal' && (
                  <div className="relative w-28">
                    {draft.method === 'adjustment' && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">±</span>}
                    <Input
                      inputMode="decimal"
                      value={draft.values[p] ?? ''}
                      onChange={(e) => set({ values: { ...draft.values, [p]: e.target.value } })}
                      placeholder={draft.method === 'shares' ? '1' : draft.method === 'percentage' ? '0' : '0.00'}
                      aria-label={`${SPLIT_METHOD_LABELS[draft.method]} for ${name(p)}`}
                      className={cn('h-9 text-right tabular', draft.method === 'adjustment' && 'pl-6', (draft.method === 'percentage' || draft.method === 'shares') && 'pr-7')}
                    />
                    {draft.method === 'percentage' && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">%</span>}
                    {draft.method === 'shares' && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">×</span>}
                  </div>
                )}
                <div className="w-24 text-right">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={alloc ?? 'none'} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} className="tabular block text-sm font-semibold">
                      {included && alloc !== undefined ? formatMoney(alloc, currency) : '—'}
                    </motion.span>
                  </AnimatePresence>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {sumInfo && (
          <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', sumInfo.ok ? 'bg-positive-soft text-positive' : 'bg-warning-soft text-warning')}>
            {sumInfo.ok ? <CheckCircle2 className="size-3.5" /> : <AlertCircle className="size-3.5" />}
            {sumInfo.label}
          </span>
        )}
        {draft.method !== 'equal' && draft.method !== 'itemized' && (
          <Button type="button" size="sm" variant="ghost" onClick={fillEvenly}>
            Fill evenly
          </Button>
        )}
      </div>
      {(inputError || splitError) && totalMinor ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-negative-soft px-3 py-2 text-sm text-negative">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {inputError ?? splitError?.message}
          {splitError?.details.difference !== undefined && typeof splitError.details.difference === 'number' && splitError.code !== 'PERCENT_MISMATCH' && (
            <span className="tabular"> ({formatMoney(Math.abs(splitError.details.difference), currency)} {splitError.details.difference > 0 ? 'unassigned' : 'over'})</span>
          )}
        </p>
      ) : null}
    </div>
  );
}

function ItemsEditor({ people, name, currency, items, onChange }: { people: string[]; name: (id: string) => string; currency: string; items: ItemDraft[]; onChange: (i: ItemDraft[]) => void }) {
  const upd = (key: string, patch: Partial<ItemDraft>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const add = (kind: ItemDraft['kind']) =>
    onChange([...items, { key: crypto.randomUUID(), name: kind === 'item' ? '' : kind === 'tax' ? 'Tax' : kind === 'tip' ? 'Tip' : 'Discount', amount: '', kind, assignees: kind === 'item' ? [...people] : [] }]);
  return (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.key} className="rounded-xl border border-border p-3">
          <div className="flex gap-2">
            <NativeSelect value={it.kind} onChange={(e) => upd(it.key, { kind: e.target.value as ItemDraft['kind'] })} className="h-9 w-28" aria-label="Line type">
              <option value="item">Item</option>
              <option value="tax">Tax</option>
              <option value="tip">Tip</option>
              <option value="discount">Discount</option>
            </NativeSelect>
            <Input value={it.name} onChange={(e) => upd(it.key, { name: e.target.value })} placeholder="Item name" className="h-9 flex-1" aria-label="Item name" maxLength={120} />
            <Input value={it.amount} onChange={(e) => upd(it.key, { amount: e.target.value })} inputMode="decimal" placeholder="0.00" className="h-9 w-24 text-right tabular" aria-label="Item amount" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove line" onClick={() => onChange(items.filter((i) => i.key !== it.key))}>
              <Trash2 />
            </Button>
          </div>
          {it.kind === 'item' ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {people.map((p) => {
                const on = it.assignees.includes(p);
                return (
                  <button key={p} type="button" aria-pressed={on}
                    onClick={() => upd(it.key, { assignees: on ? it.assignees.filter((x) => x !== p) : [...it.assignees, p] })}
                    className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors', on ? 'border-primary bg-primary-soft text-primary' : 'border-border text-fg-muted hover:bg-muted')}>
                    {name(p)}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="mt-1.5 text-2xs text-fg-subtle">Shared in proportion to each person’s items.</p>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => add('item')}><Plus /> Item</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => add('tax')}><Plus /> Tax</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => add('tip')}><Plus /> Tip</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => add('discount')}><Plus /> Discount</Button>
      </div>
      <p className="sr-only">Currency {currency}</p>
    </div>
  );
}
