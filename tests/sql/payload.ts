import { computeSplit, type SplitMethod, type ParticipantInput, type ItemInput } from '../../packages/core/src';

export interface PayloadOpts {
  groupId?: string | null;
  description?: string;
  amount: number;
  currency?: string;
  date?: string;
  payers: [string, number][];
  participants: string[] | ParticipantInput[];
  method?: SplitMethod;
  items?: ItemInput[];
  categoryId?: string | null;
}

/** Builds an expense RPC payload exactly the way the web client does (core engine computes the splits). */
export function expensePayload(o: PayloadOpts) {
  const method = o.method ?? 'equal';
  const participants: ParticipantInput[] = (o.participants as (string | ParticipantInput)[]).map((p) =>
    typeof p === 'string' ? { userId: p } : p,
  );
  const allocations = computeSplit({ method, totalMinor: o.amount, participants, items: o.items });
  return {
    group_id: o.groupId ?? null,
    description: o.description ?? 'Test expense',
    amount_minor: o.amount,
    currency: o.currency ?? 'INR',
    expense_date: o.date ?? new Date().toISOString().slice(0, 10),
    category_id: o.categoryId ?? null,
    notes: null,
    tags: [],
    split_method: method,
    payers: o.payers.map(([user_id, amount_minor]) => ({ user_id, amount_minor })),
    participants: participants.map((p) => ({ user_id: p.userId, included: p.included !== false, value: p.value ?? null })),
    splits: allocations.map((a) => ({ user_id: a.userId, amount_minor: a.amountMinor })),
    items: (o.items ?? []).map((i) => ({
      name: i.name,
      amount_minor: i.amountMinor,
      kind: i.kind ?? 'item',
      assignees: i.assignees.map((a) => ({ user_id: a.userId, weight: a.weight ?? 1 })),
    })),
    receipt_id: null,
  };
}
