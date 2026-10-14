import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { unwrap } from '@/lib/errors';
import { useAuth } from '@/features/auth/AuthProvider';
import type {
  ActivityEvent, BalanceRow, Budget, Category, Comment, Entitlement, ExchangeRate, Expense, ExpenseRevision, FriendInvitation,
  Friendship, Group, GroupInvitation, GroupMember, Notification, Preferences, Profile, RecurringTemplate, SavedFilter,
  Settlement, SpendingRowDb, SplitTemplate,
} from '@/types/db';

export const PROFILE_COLUMNS = 'id, display_name, avatar_url, avatar_color, default_currency, timezone, onboarded_at, is_demo, deleted_at, created_at';
export const EXPENSE_LIST_SELECT = '*, expense_payers(user_id, amount_minor), expense_splits(user_id, amount_minor)';

export const qk = {
  me: ['me'] as const,
  contacts: ['contacts'] as const,
  categories: ['categories'] as const,
  groups: ['groups'] as const,
  group: (id: string) => ['group', id] as const,
  groupLedger: (id: string) => ['group-ledger', id] as const,
  groupInvites: (id: string) => ['group-invites', id] as const,
  friends: ['friends'] as const,
  balances: ['balances'] as const,
  expenses: (f: unknown) => ['expenses', f] as const,
  expense: (id: string) => ['expense', id] as const,
  settlements: (f: unknown) => ['settlements', f] as const,
  activity: (groupId?: string | null) => ['activity', groupId ?? 'all'] as const,
  notifications: ['notifications'] as const,
  recurring: ['recurring'] as const,
  spending: (from: string, to: string) => ['spending', from, to] as const,
  budgets: ['budgets'] as const,
  rates: ['rates'] as const,
  splitTemplates: ['split-templates'] as const,
  savedFilters: ['saved-filters'] as const,
  devStatus: ['dev-status'] as const,
  comments: (id: string) => ['comments', id] as const,
};

/** After any financial change, everything derived from the ledger must refresh. */
export function invalidateFinancial(qc: QueryClient) {
  for (const k of ['balances', 'expenses', 'expense', 'settlements', 'activity', 'spending', 'groups', 'group', 'group-ledger', 'notifications', 'recurring', 'contacts']) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
}

// ---------- Current user ------------------------------------------------------
export interface Me {
  profile: Profile;
  preferences: Preferences;
  entitlement: Entitlement | null;
  email: string;
  isPlus: boolean;
}

export function useMe() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.me,
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<Me> => {
      const [p, prefs, ent] = await Promise.all([
        supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', user!.id).single(),
        supabase.from('user_preferences').select('*').eq('user_id', user!.id).single(),
        supabase.from('subscription_entitlements').select('*').eq('user_id', user!.id).maybeSingle(),
      ]);
      const profile = unwrap(p) as unknown as Profile;
      const entitlement = unwrap(ent) as Entitlement | null;
      const isPlus =
        !!entitlement && entitlement.plan === 'plus' && entitlement.status === 'active' &&
        (!entitlement.current_period_end || new Date(entitlement.current_period_end) > new Date());
      return { profile, preferences: unwrap(prefs) as Preferences, entitlement, email: user!.email ?? '', isPlus };
    },
  });
}

export interface Contact {
  id: string;
  display_name: string;
  avatar_url: string | null;
  avatar_color: string;
  default_currency: string;
  deleted_at: string | null;
  is_demo: boolean;
}

/** Everyone the user may see, as a lookup map. */
export function useContacts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.contacts,
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc('get_visible_profiles')) as Contact[];
      return new Map(rows.map((r) => [r.id, r]));
    },
  });
}

export function useNameOf() {
  const { data } = useContacts();
  const { user } = useAuth();
  return (id: string | null | undefined, opts: { you?: boolean } = { you: true }) => {
    if (!id) return 'Someone';
    if (opts.you !== false && id === user?.id) return 'You';
    return data?.get(id)?.display_name ?? 'Former member';
  };
}

export function useCategories() {
  return useQuery({
    queryKey: qk.categories,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.from('categories').select('*').order('is_system', { ascending: false }).order('name')) as Category[],
  });
}

// ---------- Groups -----------------------------------------------------------
export interface GroupWithMembers extends Group {
  group_members: GroupMember[];
}

export function useGroups() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.groups,
    enabled: !!user,
    queryFn: async () =>
      unwrap(await supabase.from('groups').select('*, group_members(*)').order('archived_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: false })) as GroupWithMembers[],
  });
}

export function useGroup(id: string | undefined) {
  return useQuery({
    queryKey: qk.group(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('groups').select('*, group_members(*)').eq('id', id!).maybeSingle()) as GroupWithMembers | null,
  });
}

export function useGroupLedger(id: string | undefined) {
  return useQuery({
    queryKey: qk.groupLedger(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      unwrap(await supabase.from('ledger_entries').select('debtor_id, creditor_id, currency, amount_minor').eq('group_id', id!)) as {
        debtor_id: string; creditor_id: string; currency: string; amount_minor: number;
      }[],
  });
}

export function useGroupInvites(id: string | undefined) {
  return useQuery({
    queryKey: qk.groupInvites(id ?? ''),
    enabled: !!id,
    queryFn: async () =>
      unwrap(await supabase.from('group_invitations').select('*').eq('group_id', id!).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })) as GroupInvitation[],
  });
}

// ---------- Friends ----------------------------------------------------------
export function useFriends() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.friends,
    enabled: !!user,
    queryFn: async () => {
      const [f, inv] = await Promise.all([
        supabase.from('friendships').select('*').is('removed_at', null),
        supabase.from('friendship_invitations').select('*').eq('status', 'pending').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }),
      ]);
      const friendships = unwrap(f) as Friendship[];
      const invites = unwrap(inv) as FriendInvitation[];
      return {
        friendIds: friendships.map((x) => (x.user_a === user!.id ? x.user_b : x.user_a)),
        friendships,
        incoming: invites.filter((i) => i.invitee_id === user!.id),
        outgoing: invites.filter((i) => i.inviter_id === user!.id),
      };
    },
  });
}

// ---------- Balances ---------------------------------------------------------
export function useBalanceOverview() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.balances,
    enabled: !!user,
    queryFn: async () => (unwrap(await supabase.rpc('get_balance_overview')) as BalanceRow[]).map((r) => ({ ...r, net_minor: Number(r.net_minor) })),
  });
}

// ---------- Expenses ---------------------------------------------------------
export interface ExpenseFilters {
  search?: string;
  groupId?: string | 'none' | '';
  categoryId?: string;
  currency?: string;
  from?: string;
  to?: string;
  involvingMe?: boolean;
  includeDeleted?: boolean;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  page?: number;
  pageSize?: number;
  friendId?: string;
}

export function useExpenses(filters: ExpenseFilters) {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.expenses(filters),
    enabled: !!user,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const pageSize = filters.pageSize ?? 20;
      const page = filters.page ?? 0;
      let q = supabase.from('expenses').select(EXPENSE_LIST_SELECT, { count: 'exact' });
      if (!filters.includeDeleted) q = q.is('deleted_at', null);
      if (filters.search?.trim()) q = q.ilike('description', `%${filters.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`);
      if (filters.groupId === 'none') q = q.is('group_id', null);
      else if (filters.groupId) q = q.eq('group_id', filters.groupId);
      if (filters.categoryId) q = q.eq('category_id', filters.categoryId);
      if (filters.currency) q = q.eq('currency', filters.currency);
      if (filters.from) q = q.gte('expense_date', filters.from);
      if (filters.to) q = q.lte('expense_date', filters.to);
      if (filters.involvingMe || filters.friendId) {
        const ids = [user!.id, ...(filters.friendId ? [filters.friendId] : [])];
        const sets = await Promise.all(
          ids.map(async (uid) => {
            const [a, b] = await Promise.all([
              supabase.from('expense_participants').select('expense_id').eq('user_id', uid),
              supabase.from('expense_payers').select('expense_id').eq('user_id', uid),
            ]);
            return new Set([...(unwrap(a) as { expense_id: string }[]), ...(unwrap(b) as { expense_id: string }[])].map((r) => r.expense_id));
          }),
        );
        const both = [...sets[0]!].filter((id) => sets.every((s) => s.has(id)));
        if (both.length === 0) return { rows: [] as Expense[], count: 0 };
        q = q.in('id', both.slice(0, 500));
      }
      const sort = filters.sort ?? 'date_desc';
      q = sort.startsWith('date')
        ? q.order('expense_date', { ascending: sort === 'date_asc' }).order('created_at', { ascending: sort === 'date_asc' })
        : q.order('amount_minor', { ascending: sort === 'amount_asc' });
      const res = await q.range(page * pageSize, page * pageSize + pageSize - 1);
      if (res.error) throw res.error;
      return { rows: (res.data ?? []) as unknown as Expense[], count: res.count ?? 0 };
    },
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: qk.expense(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const e = unwrap(
        await supabase
          .from('expenses')
          .select('*, expense_payers(*), expense_splits(*), expense_participants(*), expense_items(*, expense_item_assignments(*))')
          .eq('id', id!)
          .maybeSingle(),
      ) as Expense | null;
      if (e?.expense_items) e.expense_items.sort((a, b) => a.position - b.position);
      return e;
    },
  });
}

export function useExpenseRevisions(id: string | undefined) {
  return useQuery({
    queryKey: ['expense-revisions', id],
    enabled: !!id,
    queryFn: async () => unwrap(await supabase.from('expense_revisions').select('*').eq('expense_id', id!).order('version', { ascending: false })) as ExpenseRevision[],
  });
}

export function useComments(expenseId: string | undefined) {
  return useQuery({
    queryKey: qk.comments(expenseId ?? ''),
    enabled: !!expenseId,
    queryFn: async () => unwrap(await supabase.from('comments').select('*').eq('expense_id', expenseId!).is('deleted_at', null).order('created_at')) as Comment[],
  });
}

// ---------- Settlements ------------------------------------------------------
export function useSettlements(f: { groupId?: string; friendId?: string; limit?: number } = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.settlements(f),
    enabled: !!user,
    queryFn: async () => {
      let q = supabase.from('settlements').select('*').order('settled_on', { ascending: false }).order('created_at', { ascending: false }).limit(f.limit ?? 200);
      if (f.groupId) q = q.eq('group_id', f.groupId);
      if (f.friendId) q = q.or(`and(payer_id.eq.${user!.id},payee_id.eq.${f.friendId}),and(payer_id.eq.${f.friendId},payee_id.eq.${user!.id})`);
      return unwrap(await q) as Settlement[];
    },
  });
}

// ---------- Activity & notifications ----------------------------------------
export function useActivity(groupId?: string | null, limit = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...qk.activity(groupId), limit],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase.from('activity_events').select('*').order('created_at', { ascending: false }).limit(limit);
      if (groupId) q = q.eq('group_id', groupId);
      return unwrap(await q) as ActivityEvent[];
    },
  });
}

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.notifications,
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)) as Notification[],
  });
}

// ---------- Recurring, analytics, Plus ---------------------------------------
export function useRecurring() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.recurring,
    enabled: !!user,
    queryFn: async () => unwrap(await supabase.from('recurring_expense_templates').select('*').order('status').order('next_occurrence_on', { ascending: true, nullsFirst: false })) as RecurringTemplate[],
  });
}

export function useSpending(from: string, to: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.spending(from, to),
    enabled: !!user,
    queryFn: async () =>
      (unwrap(await supabase.rpc('get_my_spending', { p_from: from, p_to: to })) as SpendingRowDb[]).map((r) => ({
        ...r,
        total_minor: Number(r.total_minor),
        my_share_minor: Number(r.my_share_minor),
        my_paid_minor: Number(r.my_paid_minor),
      })),
  });
}

export function useBudgets() {
  return useQuery({ queryKey: qk.budgets, queryFn: async () => unwrap(await supabase.from('budgets').select('*').order('created_at')) as Budget[] });
}

export function useRates() {
  return useQuery({
    queryKey: qk.rates,
    queryFn: async () => unwrap(await supabase.from('exchange_rate_snapshots').select('*').order('as_of', { ascending: false }).order('created_at', { ascending: false })) as ExchangeRate[],
  });
}

export function useSplitTemplates() {
  return useQuery({ queryKey: qk.splitTemplates, queryFn: async () => unwrap(await supabase.from('split_templates').select('*').order('name')) as SplitTemplate[] });
}

export function useSavedFilters() {
  return useQuery({ queryKey: qk.savedFilters, queryFn: async () => unwrap(await supabase.from('saved_filters').select('*').order('created_at')) as SavedFilter[] });
}

export function useDevStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: qk.devStatus,
    enabled: !!user,
    staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('get_dev_tools_status')) as { mode: string; premium_switch_allowed: boolean },
  });
}

// ---------- Generic RPC mutation helper -------------------------------------
export function useRpc<TArgs extends Record<string, unknown>, TResult = unknown>(fn: string, opts: { invalidate?: 'financial' | string[][] } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => unwrap(await supabase.rpc(fn, args)) as TResult,
    onSuccess: () => {
      if (opts.invalidate === 'financial') invalidateFinancial(qc);
      else opts.invalidate?.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
    },
  });
}
