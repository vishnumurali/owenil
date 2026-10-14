// Row types for the Owenil schema (see supabase/migrations). Amounts are
// integer minor units (bigint in Postgres, number in JSON).
import type { SplitMethod, Frequency } from '@owenil/core';

export type GroupRole = 'owner' | 'admin' | 'member';
export type MemberStatus = 'active' | 'left' | 'removed';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  avatar_color: string;
  default_currency: string;
  timezone: string;
  onboarded_at: string | null;
  is_demo: boolean;
  is_tester: boolean;
  deleted_at: string | null;
  created_at: string;
}

export interface Preferences {
  user_id: string;
  theme: 'light' | 'dark' | 'system';
  locale: string;
  report_currency: string | null;
  week_starts_on: number;
  notify_expenses: boolean;
  notify_settlements: boolean;
  notify_comments: boolean;
  notify_budget_alerts: boolean;
  notify_recurring: boolean;
  discoverable_by_email: boolean;
}

export interface Entitlement {
  user_id: string;
  plan: 'free' | 'plus';
  status: 'active' | 'expired' | 'revoked';
  source: string;
  current_period_end: string | null;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  group_type: 'travel' | 'home' | 'couple' | 'family' | 'outing' | 'other';
  emoji: string;
  color: string;
  default_currency: string;
  simplify_debts: boolean;
  default_split: { method: SplitMethod; participants: { user_id: string; value: number | null }[] } | null;
  created_by: string;
  archived_at: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupRole;
  status: MemberStatus;
  joined_at: string;
  left_at: string | null;
}

export interface GroupInvitation {
  id: string;
  group_id: string;
  created_by: string;
  role: GroupRole;
  max_uses: number;
  use_count: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
  owner_id: string | null;
  is_system: boolean;
}

export interface ExpensePayer {
  expense_id: string;
  user_id: string;
  amount_minor: number;
}
export interface ExpenseParticipant {
  expense_id: string;
  user_id: string;
  included: boolean;
  input_value: number | null;
}
export interface ExpenseSplit {
  expense_id: string;
  user_id: string;
  amount_minor: number;
}
export interface ExpenseItem {
  id: string;
  expense_id: string;
  name: string;
  amount_minor: number;
  kind: 'item' | 'tax' | 'tip' | 'discount';
  position: number;
  expense_item_assignments?: { user_id: string; weight: number }[];
}

export interface Expense {
  id: string;
  group_id: string | null;
  description: string;
  amount_minor: number;
  currency: string;
  expense_date: string;
  category_id: string | null;
  notes: string | null;
  tags: string[];
  split_method: SplitMethod;
  receipt_id: string | null;
  recurring_template_id: string | null;
  created_by: string;
  version: number;
  deleted_at: string | null;
  deleted_by: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  expense_payers?: ExpensePayer[];
  expense_splits?: ExpenseSplit[];
  expense_participants?: ExpenseParticipant[];
  expense_items?: ExpenseItem[];
}

export interface ExpenseRevision {
  id: string;
  expense_id: string;
  version: number;
  change_type: 'created' | 'updated' | 'deleted' | 'restored';
  snapshot: { expense: Partial<Expense>; payers: { user_id: string; amount_minor: number }[]; splits: { user_id: string; amount_minor: number }[] };
  changed_by: string | null;
  created_at: string;
}

export interface Settlement {
  id: string;
  group_id: string | null;
  payer_id: string;
  payee_id: string;
  amount_minor: number;
  currency: string;
  settled_on: string;
  method: 'cash' | 'upi' | 'bank_transfer' | 'card' | 'other';
  note: string | null;
  created_by: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  is_demo: boolean;
  created_at: string;
  /** Set when the repayment was made for one specific expense. */
  expense_id: string | null;
}

export interface Friendship {
  id: string;
  user_a: string;
  user_b: string;
  created_at: string;
  removed_at: string | null;
}

export interface FriendInvitation {
  id: string;
  inviter_id: string;
  invitee_email: string | null;
  invitee_id: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  expires_at: string;
  created_at: string;
}

export interface RecurringTemplate {
  id: string;
  created_by: string;
  group_id: string | null;
  description: string;
  amount_minor: number;
  currency: string;
  category_id: string | null;
  frequency: Frequency;
  start_date: string;
  end_date: string | null;
  status: 'active' | 'paused' | 'cancelled';
  next_index: number;
  next_occurrence_on: string | null;
  payload: {
    split_method: SplitMethod;
    payers: { user_id: string; amount_minor: number }[];
    participants: { user_id: string; included: boolean; value: number | null }[];
    splits: { user_id: string; amount_minor: number }[];
    notes: string | null;
    tags: string[];
  };
  last_error: string | null;
  is_demo: boolean;
  created_at: string;
}

export interface ActivityEvent {
  id: string;
  group_id: string | null;
  actor_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  summary: Record<string, unknown>;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  expense_id: string | null;
  settlement_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

export interface Budget {
  id: string;
  user_id: string;
  name: string;
  category_id: string | null;
  group_id: string | null;
  amount_minor: number;
  currency: string;
  period: 'monthly' | 'yearly';
  alert_threshold_pct: number;
}

export interface ExchangeRate {
  id: string;
  user_id: string;
  base_currency: string;
  quote_currency: string;
  rate: number | string;
  as_of: string;
  source: 'manual';
  note: string | null;
  created_at: string;
}

export interface ReceiptMeta {
  id: string;
  owner_id: string;
  expense_id: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  merchant: string | null;
  receipt_date: string | null;
  currency: string | null;
  subtotal_minor: number | null;
  tax_minor: number | null;
  tip_minor: number | null;
  total_minor: number | null;
}

export interface SplitTemplate {
  id: string;
  owner_id: string;
  group_id: string | null;
  name: string;
  split_method: SplitMethod;
  participants: { user_id: string; value: number | null }[];
}

export interface SavedFilter {
  id: string;
  user_id: string;
  name: string;
  filters: Record<string, string>;
}

export interface BalanceRow {
  kind: 'group_net' | 'pair';
  group_id: string | null;
  user_id: string;
  currency: string;
  net_minor: number;
}

export interface SpendingRowDb {
  expense_id: string;
  expense_date: string;
  description: string;
  currency: string;
  category_id: string | null;
  group_id: string | null;
  total_minor: number;
  my_share_minor: number;
  my_paid_minor: number;
  is_recurring: boolean;
  payers: { user_id: string; amount_minor: number }[];
}
