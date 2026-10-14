import type { SupabaseClient } from '@supabase/supabase-js';
import { minorToDecimalString, toCSV } from '@owenil/core';
import type { Expense, Settlement } from '@/types/db';

/**
 * Export builders. Pure functions over rows the user is already authorised to
 * read (RLS applies to every fetch), so exports can never include data the
 * user couldn't see in the app. Amounts are written as exact decimal strings.
 */
export interface ExportFilter {
  from?: string;
  to?: string;
  groupId?: string;
}

export async function fetchExpensesForExport(client: SupabaseClient, f: ExportFilter): Promise<Expense[]> {
  const out: Expense[] = [];
  for (let page = 0; page < 50; page++) {
    let q = client
      .from('expenses')
      .select('*, expense_payers(user_id, amount_minor), expense_splits(user_id, amount_minor)')
      .is('deleted_at', null)
      .order('expense_date')
      .order('id')
      .range(page * 1000, page * 1000 + 999);
    if (f.from) q = q.gte('expense_date', f.from);
    if (f.to) q = q.lte('expense_date', f.to);
    if (f.groupId) q = q.eq('group_id', f.groupId);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Expense[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function fetchSettlementsForExport(client: SupabaseClient, f: ExportFilter): Promise<Settlement[]> {
  let q = client.from('settlements').select('*').order('settled_on').order('id').limit(5000);
  if (f.from) q = q.gte('settled_on', f.from);
  if (f.to) q = q.lte('settled_on', f.to);
  if (f.groupId) q = q.eq('group_id', f.groupId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Settlement[];
}

export interface Lookups {
  me: string;
  name: (id: string) => string;
  category: (id: string | null) => string;
  group: (id: string | null) => string;
}

export const EXPENSE_CSV_HEADERS = [
  'Date', 'Description', 'Group', 'Category', 'Currency', 'Amount', 'Paid by', 'Split method', 'Shares',
  'My share', 'I paid', 'My net', 'Notes', 'Tags', 'Expense ID', 'Version',
];

export function expensesToCSV(expenses: Expense[], l: Lookups): string {
  const rows = expenses.map((e) => {
    const cur = e.currency;
    const payers = e.expense_payers ?? [];
    const splits = e.expense_splits ?? [];
    const myShare = splits.filter((s) => s.user_id === l.me).reduce((a, s) => a + Number(s.amount_minor), 0);
    const myPaid = payers.filter((p) => p.user_id === l.me).reduce((a, p) => a + Number(p.amount_minor), 0);
    return [
      e.expense_date,
      e.description,
      l.group(e.group_id),
      l.category(e.category_id),
      cur,
      minorToDecimalString(Number(e.amount_minor), cur),
      payers.map((p) => `${l.name(p.user_id)}: ${minorToDecimalString(Number(p.amount_minor), cur)}`).join('; '),
      e.split_method,
      splits.map((s) => `${l.name(s.user_id)}: ${minorToDecimalString(Number(s.amount_minor), cur)}`).join('; '),
      minorToDecimalString(myShare, cur),
      minorToDecimalString(myPaid, cur),
      minorToDecimalString(myPaid - myShare, cur),
      e.notes ?? '',
      (e.tags ?? []).join(', '),
      e.id,
      e.version,
    ];
  });
  return toCSV(EXPENSE_CSV_HEADERS, rows);
}

export const SETTLEMENT_CSV_HEADERS = ['Date', 'From', 'To', 'Currency', 'Amount', 'Method', 'Group', 'Note', 'Status', 'Settlement ID'];

export function settlementsToCSV(settlements: Settlement[], l: Lookups): string {
  return toCSV(
    SETTLEMENT_CSV_HEADERS,
    settlements.map((s) => [
      s.settled_on, l.name(s.payer_id), l.name(s.payee_id), s.currency, minorToDecimalString(Number(s.amount_minor), s.currency),
      s.method, l.group(s.group_id), s.note ?? '', s.reversed_at ? 'reversed' : 'recorded', s.id,
    ]),
  );
}

export function expensesToJSON(expenses: Expense[], l: Lookups) {
  return expenses.map((e) => ({
    id: e.id,
    date: e.expense_date,
    description: e.description,
    group: l.group(e.group_id),
    category: l.category(e.category_id),
    currency: e.currency,
    amount: minorToDecimalString(Number(e.amount_minor), e.currency),
    amount_minor: Number(e.amount_minor),
    split_method: e.split_method,
    payers: (e.expense_payers ?? []).map((p) => ({ user_id: p.user_id, name: l.name(p.user_id), amount_minor: Number(p.amount_minor) })),
    shares: (e.expense_splits ?? []).map((s) => ({ user_id: s.user_id, name: l.name(s.user_id), amount_minor: Number(s.amount_minor) })),
    notes: e.notes,
    tags: e.tags,
    version: e.version,
  }));
}
