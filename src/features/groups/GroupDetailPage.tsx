import * as React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, ArrowLeft, ArrowRight, Crown, Download, HandCoins, LogOut, MoreHorizontal, Pencil, Plus, Search, Shield,
  Trash2, UserMinus, UserPlus, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { contributionsByPayer, formatMoney, GROUP_TYPE_LABELS, simplifyDebts, totalsBy, type SpendingRow } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { appUrl } from '@/lib/env';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDebounced, useDocumentTitle } from '@/lib/hooks';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  invalidateFinancial, qk, useActivity, useBalanceOverview, useCategories, useContacts, useExpenses, useFriends, useGroup, useGroupInvites,
  useGroupLedger, useMe, useNameOf,
} from '@/data/queries';
import { groupNetsFromRows, pairwiseFromLedger, type Edge } from '@/data/balances';
import type { GroupRole } from '@/types/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Avatar, AvatarStack } from '@/components/ui/avatar';
import { Badge, Skeleton, Switch } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { EmptyState, ErrorState, FitBody, FitScreen, SectionTitle } from '@/components/ui/layout-bits';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { CategoryIcon, ExpenseRow, GroupBadge, PlusGate } from '@/components/domain';
import { ActivityList } from '@/components/activity';
import { ChartCard, RankedBars } from '@/components/charts';
import { SettleUpDialog, type SettleDefaults } from '@/features/balances/SettleUpDialog';
import { InviteLinkBox } from '@/features/friends/InviteFriendDialog';

type Tab = 'expenses' | 'balances' | 'members' | 'activity' | 'insights';

export default function GroupDetailPage() {
  const { groupId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const me = user!.id;
  const group = useGroup(groupId);
  const contacts = useContacts();
  const [tab, setTab] = React.useState<Tab>((params.get('tab') as Tab) ?? 'expenses');
  const [inviteOpen, setInviteOpen] = React.useState(params.get('invite') === '1');
  const [settle, setSettle] = React.useState<SettleDefaults | null>(null);
  const [confirm, setConfirm] = React.useState<null | 'leave' | 'delete' | 'archive'>(null);
  const [busy, setBusy] = React.useState(false);
  useDocumentTitle(group.data?.name ?? 'Group');

  React.useEffect(() => {
    if (params.get('invite')) {
      params.delete('invite');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  if (group.isLoading) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div>;
  if (group.isError) return <ErrorState error={group.error} onRetry={() => group.refetch()} />;
  const g = group.data;
  if (!g) {
    return (
      <Card>
        <EmptyState illustration="groups" title="Group not found" description="It may have been deleted, or you’re no longer a member." action={<Button asChild variant="outline"><Link to="/groups">Back to groups</Link></Button>} />
      </Card>
    );
  }
  const members = g.group_members.filter((m) => m.status === 'active');
  const myRole = members.find((m) => m.user_id === me)?.role;
  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const archived = !!g.archived_at;

  const run = async (fn: string, args: Record<string, unknown>, success: string, after?: () => void) => {
    setBusy(true);
    try {
      unwrap(await supabase.rpc(fn, args));
      toast.success(success);
      invalidateFinancial(qc);
      after?.();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <FitScreen>
      <div className="shrink-0 space-y-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild className="-ml-1.5 shrink-0">
            <Link to="/groups" aria-label="Back to groups">
              <ArrowLeft />
            </Link>
          </Button>
          <GroupBadge emoji={g.emoji} color={g.color} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-lg font-semibold leading-tight sm:text-xl">{g.name}</h1>
              {archived && <Badge tone="warning"><Archive /> Archived</Badge>}
              {g.is_demo && <Badge tone="warning">Demo</Badge>}
            </div>
            <p className="truncate text-xs text-fg-muted">
              {GROUP_TYPE_LABELS[g.group_type]} · {members.length} members · {g.default_currency}
              {g.simplify_debts && ' · simplified debts'}
            </p>
            {g.description && <p className="truncate text-xs text-fg-subtle">{g.description}</p>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label="Group actions" className="shrink-0">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {!archived && (
                <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
                  <UserPlus /> Invite people
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <DropdownMenuItem onSelect={() => navigate(`/groups/${g.id}/edit`)}>
                  <Pencil /> Edit group
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => navigate(`/export?group=${g.id}`)}>
                <Download /> Export report
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isAdmin && (
                <DropdownMenuItem onSelect={() => (archived ? run('set_group_archived', { p_group_id: g.id, p_archived: false }, 'Group unarchived') : setConfirm('archive'))}>
                  {archived ? <ArchiveRestore /> : <Archive />} {archived ? 'Unarchive' : 'Archive'}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem destructive onSelect={() => setConfirm('leave')}>
                <LogOut /> Leave group
              </DropdownMenuItem>
              {myRole === 'owner' && (
                <DropdownMenuItem destructive onSelect={() => setConfirm('delete')}>
                  <Trash2 /> Delete group
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-2">
          {!archived && (
            <Button asChild size="sm">
              <Link to={`/expenses/new?group=${g.id}`}>
                <Plus /> Add expense
              </Link>
            </Button>
          )}
          {!archived && (
            <Button size="sm" variant="outline" onClick={() => setSettle({ groupId: g.id, currency: g.default_currency })}>
              <HandCoins /> Settle up
            </Button>
          )}
          <div className="ml-auto hidden min-[380px]:block">
            <AvatarStack max={4} people={members.map((m) => ({ name: contacts.data?.get(m.user_id)?.display_name ?? '?', color: contacts.data?.get(m.user_id)?.avatar_color }))} />
          </div>
        </div>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          ariaLabel="Group sections"
          size="sm"
          className="w-full"
          options={[
            { value: 'expenses', label: 'Expenses' },
            { value: 'balances', label: 'Balances' },
            { value: 'members', label: 'Members' },
            { value: 'activity', label: 'Activity' },
            { value: 'insights', label: 'Insights' },
          ]}
        />
      </div>

      <FitBody className="pt-3">
        {tab === 'expenses' && <GroupExpenses groupId={g.id} />}
        {tab === 'balances' && <GroupBalances groupId={g.id} simplify={g.simplify_debts} isAdmin={isAdmin} archived={archived} onSettle={setSettle} />}
        {tab === 'members' && <GroupMembers groupId={g.id} myRole={myRole} archived={archived} onInvite={() => setInviteOpen(true)} />}
        {tab === 'activity' && <GroupActivity groupId={g.id} />}
        {tab === 'insights' && <GroupInsights groupId={g.id} currency={g.default_currency} />}
      </FitBody>

      <SettleUpDialog open={!!settle} onOpenChange={(o) => !o && setSettle(null)} defaults={settle ?? {}} />
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} groupId={g.id} groupName={g.name} isAdmin={isAdmin} />
      <ConfirmDialog
        open={confirm === 'leave'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Leave ${g.name}?`}
        description="You can leave once your balance in this group is settled. Owners must hand over ownership first. Past expenses stay in the group’s history."
        confirmLabel="Leave group"
        destructive
        loading={busy}
        onConfirm={() => run('leave_group', { p_group_id: g.id }, 'You left the group', () => navigate('/groups'))}
      />
      <ConfirmDialog
        open={confirm === 'archive'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Archive this group?"
        description="Archived groups are read-only: no new expenses or repayments until an admin unarchives it. Balances are kept."
        confirmLabel="Archive"
        loading={busy}
        onConfirm={() => run('set_group_archived', { p_group_id: g.id, p_archived: true }, 'Group archived')}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Delete ${g.name}?`}
        description="Only possible when every balance is settled. The group disappears for everyone; its financial records are retained for audit."
        confirmLabel="Delete group"
        destructive
        loading={busy}
        onConfirm={() => run('delete_group', { p_group_id: g.id }, 'Group deleted', () => navigate('/groups'))}
      />
    </FitScreen>
  );
}

function GroupExpenses({ groupId }: { groupId: string }) {
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(0);
  const q = useDebounced(search);
  const expenses = useExpenses({ groupId, search: q, page, pageSize: 20 });
  const categories = useCategories();
  const catMap = React.useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  React.useEffect(() => setPage(0), [q]);
  return (
    <Card className="p-2 sm:p-3">
      <div className="relative m-1 mb-2 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this group" className="pl-9" aria-label="Search group expenses" />
      </div>
      {expenses.isLoading ? (
        <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : expenses.isError ? (
        <ErrorState error={expenses.error} onRetry={() => expenses.refetch()} />
      ) : expenses.data?.rows.length ? (
        <>
          {expenses.data.rows.map((e) => <ExpenseRow key={e.id} expense={e} categories={catMap} />)}
          {expenses.data.count > 20 && (
            <div className="flex items-center justify-between p-2 text-sm">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <span className="text-fg-muted">Page {page + 1} of {Math.ceil(expenses.data.count / 20)}</span>
              <Button size="sm" variant="ghost" disabled={(page + 1) * 20 >= expenses.data.count} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState title={q ? 'No matching expenses' : 'No expenses yet'} description={q ? 'Try a different search.' : 'Add the first expense for this group.'} action={!q ? <Button asChild><Link to={`/expenses/new?group=${groupId}`}><Plus /> Add expense</Link></Button> : undefined} />
      )}
    </Card>
  );
}

function GroupBalances({ groupId, simplify, isAdmin, archived, onSettle }: { groupId: string; simplify: boolean; isAdmin: boolean; archived: boolean; onSettle: (d: SettleDefaults) => void }) {
  const { user } = useAuth();
  const me = user!.id;
  const qc = useQueryClient();
  const balances = useBalanceOverview();
  const ledger = useGroupLedger(groupId);
  const nameOf = useNameOf();
  const contacts = useContacts();
  const nets = groupNetsFromRows(balances.data ?? []).get(groupId) ?? new Map<string, Map<string, number>>();
  const transfers: Edge[] = simplify
    ? [...nets.entries()].flatMap(([currency, m]) => simplifyDebts(m).map((t) => ({ groupId, fromId: t.fromUserId, toId: t.toUserId, currency, amountMinor: t.amountMinor })))
    : pairwiseFromLedger(ledger.data ?? []).map((e) => ({ ...e, groupId }));

  const toggle = async (v: boolean) => {
    const { error } = await supabase.from('groups').update({ simplify_debts: v }).eq('id', groupId);
    if (error) toast.error(errorMessage(error));
    else {
      void qc.invalidateQueries({ queryKey: qk.groups });
      void qc.invalidateQueries({ queryKey: qk.group(groupId) });
    }
  };

  if (balances.isLoading || (!simplify && ledger.isLoading)) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <SectionTitle>Member balances</SectionTitle>
        <Card className="divide-y divide-border">
          {nets.size === 0 ? (
            <EmptyState illustration="balanced" title="Everyone is settled up" description="No one owes anything in this group." />
          ) : (
            [...nets.entries()].flatMap(([currency, m]) => [
              ...(nets.size > 1
                ? [
                    <p key={`h-${currency}`} className="bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle first:rounded-t-2xl">
                      {currency}
                    </p>,
                  ]
                : []),
              ...[...m.entries()].sort((a, b) => b[1] - a[1]).map(([uid, v]) => (
                <div key={`${currency}${uid}`} className="flex items-center gap-3 p-4">
                  <Avatar name={contacts.data?.get(uid)?.display_name ?? '?'} color={contacts.data?.get(uid)?.avatar_color} size="sm" />
                  <span className="flex-1 text-sm font-medium">{nameOf(uid)}</span>
                  <span className={`text-sm ${v > 0 ? 'text-positive' : 'text-negative'}`}>
                    <span className="text-xs">{v > 0 ? 'gets back ' : 'owes '}</span>
                    <span className="tabular font-semibold">{formatMoney(Math.abs(v), currency)}</span>
                  </span>
                </div>
              )),
            ])
          )}
        </Card>
        <p className="mt-2 text-xs text-fg-subtle">Totals per currency always add up to zero across the group.</p>
      </section>
      <section>
        <SectionTitle
          action={
            isAdmin ? (
              <label className="flex items-center gap-2 text-xs text-fg-muted">
                Simplify <Switch checked={simplify} onCheckedChange={toggle} aria-label="Simplify debts" />
              </label>
            ) : undefined
          }
        >
          {simplify ? 'Suggested repayments' : 'Who owes whom'}
        </SectionTitle>
        <Card className="divide-y divide-border">
          {transfers.length === 0 ? (
            <p className="p-8 text-center text-sm text-fg-subtle">Nothing to settle.</p>
          ) : (
            transfers.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 p-4 text-sm">
                <span className="font-medium">{nameOf(t.fromId)}</span>
                <ArrowRight className="size-4 text-fg-subtle" />
                <span className="font-medium">{nameOf(t.toId)}</span>
                <span className="tabular ml-auto font-semibold">{formatMoney(t.amountMinor, t.currency)}</span>
                {!archived && (t.fromId === me || t.toId === me) && (
                  <Button size="sm" variant="outline" onClick={() => onSettle({ groupId, payerId: t.fromId, payeeId: t.toId, amountMinor: t.amountMinor, currency: t.currency })}>
                    Record
                  </Button>
                )}
              </div>
            ))
          )}
        </Card>
        {simplify && <p className="mt-2 text-xs text-fg-subtle">Suggestions only — nothing is paid until someone records a repayment. Simplifying never changes anyone’s total.</p>}
      </section>
    </div>
  );
}

function GroupMembers({ groupId, myRole, archived, onInvite }: { groupId: string; myRole?: GroupRole; archived: boolean; onInvite: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const group = useGroup(groupId);
  const contacts = useContacts();
  const friends = useFriends();
  const invites = useGroupInvites(groupId);
  const nameOf = useNameOf();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [toRemove, setToRemove] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState('');
  const members = (group.data?.group_members ?? []).filter((m) => m.status === 'active').sort((a, b) => ['owner', 'admin', 'member'].indexOf(a.role) - ['owner', 'admin', 'member'].indexOf(b.role));
  const former = (group.data?.group_members ?? []).filter((m) => m.status !== 'active');
  const addable = (friends.data?.friendIds ?? []).filter((f) => !members.some((m) => m.user_id === f));

  const call = async (key: string, fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try {
      unwrap(await supabase.rpc(fn, args));
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: qk.group(groupId) });
      void qc.invalidateQueries({ queryKey: qk.groups });
      void qc.invalidateQueries({ queryKey: qk.groupInvites(groupId) });
      void qc.invalidateQueries({ queryKey: qk.contacts });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
      setToRemove(null);
    }
  };
  const canManage = (role: GroupRole) => myRole === 'owner' ? role !== 'owner' : myRole === 'admin' && role === 'member';

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section>
        <SectionTitle action={!archived ? <Button size="sm" variant="outline" onClick={onInvite}><UserPlus /> Invite</Button> : undefined}>Members</SectionTitle>
        <Card className="divide-y divide-border">
          {members.map((m) => {
            const p = contacts.data?.get(m.user_id);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 p-4">
                <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{nameOf(m.user_id)}</p>
                  <p className="text-xs text-fg-subtle">Joined {formatDate(m.joined_at)}</p>
                </div>
                {m.role === 'owner' && <Badge tone="primary"><Crown /> Owner</Badge>}
                {m.role === 'admin' && <Badge tone="accent"><Shield /> Admin</Badge>}
                {m.user_id !== user?.id && canManage(m.role) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`Manage ${p?.display_name}`} disabled={busy === m.user_id}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {m.role === 'member' && (
                        <DropdownMenuItem onSelect={() => call(m.user_id, 'set_group_member_role', { p_group_id: groupId, p_user_id: m.user_id, p_role: 'admin' }, 'Now an admin')}>
                          <Shield /> Make admin
                        </DropdownMenuItem>
                      )}
                      {m.role === 'admin' && myRole === 'owner' && (
                        <DropdownMenuItem onSelect={() => call(m.user_id, 'set_group_member_role', { p_group_id: groupId, p_user_id: m.user_id, p_role: 'member' }, 'Admin role removed')}>
                          <Shield /> Remove admin role
                        </DropdownMenuItem>
                      )}
                      {myRole === 'owner' && (
                        <DropdownMenuItem onSelect={() => call(m.user_id, 'set_group_member_role', { p_group_id: groupId, p_user_id: m.user_id, p_role: 'owner' }, 'Ownership transferred')}>
                          <Crown /> Make owner
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setToRemove(m.user_id)}>
                        <UserMinus /> Remove from group
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </Card>
        {!archived && addable.length > 0 && (
          <div className="mt-3 flex gap-2">
            <NativeSelect value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add a friend">
              <option value="">Add a friend…</option>
              {addable.map((f) => (
                <option key={f} value={f}>{contacts.data?.get(f)?.display_name ?? 'Friend'}</option>
              ))}
            </NativeSelect>
            <Button disabled={!adding} loading={busy === 'add'} onClick={() => call('add', 'add_group_members', { p_group_id: groupId, p_user_ids: [adding] }, 'Member added').then(() => setAdding(''))}>
              Add
            </Button>
          </div>
        )}
        {former.length > 0 && (
          <p className="mt-3 text-xs text-fg-subtle">
            Former members: {former.map((m) => nameOf(m.user_id)).join(', ')}. Their past expenses remain in the history.
          </p>
        )}
      </section>
      <section>
        <SectionTitle>Active invite links</SectionTitle>
        <Card className="divide-y divide-border">
          {invites.data?.length ? (
            invites.data.map((i) => (
              <div key={i.id} className="flex items-center gap-3 p-4 text-sm">
                <div className="min-w-0 flex-1">
                  <p>{i.role === 'admin' ? 'Admin invite' : 'Member invite'} · {i.use_count}/{i.max_uses} used</p>
                  <p className="text-xs text-fg-subtle">By {nameOf(i.created_by)} · expires {formatDate(i.expires_at)}</p>
                </div>
                {(i.created_by === user?.id || myRole === 'owner' || myRole === 'admin') && (
                  <Button size="icon-sm" variant="ghost" aria-label="Revoke invite" loading={busy === i.id} onClick={() => call(i.id, 'revoke_group_invitation', { p_invitation_id: i.id }, 'Invite revoked')}>
                    <X />
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="p-6 text-center text-sm text-fg-subtle">No active links. Links are shown only once when created — create a new one any time.</p>
          )}
        </Card>
        <div className="mt-4 rounded-xl bg-muted/50 p-4 text-xs text-fg-muted">
          <p className="mb-1 font-medium text-fg">Roles</p>
          <p><strong>Owner</strong> — everything, including deleting the group and transferring ownership.</p>
          <p><strong>Admins</strong> — edit settings, archive, manage members and invites, edit any expense.</p>
          <p><strong>Members</strong> — add expenses, edit ones they’re part of, invite people as members.</p>
        </div>
      </section>
      <ConfirmDialog
        open={!!toRemove}
        onOpenChange={(o) => !o && setToRemove(null)}
        title="Remove member?"
        description="Members can only be removed once their balance in this group is settled. Their past expenses stay in the history."
        confirmLabel="Remove"
        destructive
        loading={busy === toRemove}
        onConfirm={() => toRemove && call(toRemove, 'remove_group_member', { p_group_id: groupId, p_user_id: toRemove }, 'Member removed')}
      />
    </div>
  );
}

function GroupActivity({ groupId }: { groupId: string }) {
  const activity = useActivity(groupId, 60);
  return (
    <Card className="p-2">
      {activity.isLoading ? (
        <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : activity.data?.length ? (
        <ActivityList events={activity.data} />
      ) : (
        <EmptyState illustration="activity" title="No activity yet" />
      )}
    </Card>
  );
}

function GroupInsights({ groupId, currency }: { groupId: string; currency: string }) {
  const expenses = useExpenses({ groupId, page: 0, pageSize: 1000 });
  const categories = useCategories();
  const nameOf = useNameOf();
  const me = useMe();
  const catMap = new Map((categories.data ?? []).map((c) => [c.id, c]));
  const rows: SpendingRow[] = (expenses.data?.rows ?? [])
    .filter((e) => e.currency === currency)
    .map((e) => ({
      expenseId: e.id, date: e.expense_date, description: e.description, currency: e.currency, categoryId: e.category_id, groupId: e.group_id,
      totalMinor: Number(e.amount_minor), myShareMinor: 0, myPaidMinor: 0, isRecurring: !!e.recurring_template_id,
      payers: (e.expense_payers ?? []).map((p) => ({ userId: p.user_id, amountMinor: Number(p.amount_minor) })),
    }));
  const total = rows.reduce((a, r) => a + r.totalMinor, 0);
  const otherCurrencies = new Set((expenses.data?.rows ?? []).map((e) => e.currency).filter((c) => c !== currency));
  if (expenses.isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-sm text-fg-muted">Total group spending</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular">{formatMoney(total, currency)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-fg-muted">Expenses</p>
          <p className="mt-1 font-display text-2xl font-semibold">{rows.length}</p>
        </Card>
        <Card className="p-5">
          <p className="text-sm text-fg-muted">Average expense</p>
          <p className="mt-1 font-display text-2xl font-semibold tabular">{formatMoney(rows.length ? Math.round(total / rows.length) : 0, currency)}</p>
        </Card>
      </div>
      {otherCurrencies.size > 0 && <p className="text-xs text-fg-subtle">Showing {currency} only. Expenses in {[...otherCurrencies].join(', ')} are not converted or included.</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="By category" subtitle={currency}>
          <RankedBars currency={currency} rows={totalsBy(rows, 'categoryId', 'totalMinor').map((c) => ({ key: c.key ?? 'none', label: c.key ? catMap.get(c.key)?.name ?? 'Other' : 'Uncategorised', value: c.amountMinor, icon: <CategoryIcon category={c.key ? catMap.get(c.key) : null} size="sm" className="size-6 rounded-md" /> }))} />
        </ChartCard>
        {me.data?.isPlus ? (
          <ChartCard title="Who paid" subtitle="Contributions by payer">
            <RankedBars currency={currency} rows={contributionsByPayer(rows).map((p) => ({ key: p.userId, label: nameOf(p.userId), value: p.amountMinor }))} />
          </ChartCard>
        ) : (
          <PlusGate feature="Detailed group reports" description="See contributions by payer, export full group reports and compare periods." />
        )}
      </div>
    </div>
  );
}

function InviteDialog({ open, onOpenChange, groupId, groupName, isAdmin }: { open: boolean; onOpenChange: (o: boolean) => void; groupId: string; groupName: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const me = useMe();
  const [role, setRole] = React.useState<'member' | 'admin'>('member');
  const [link, setLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) {
      setLink(null);
      setRole('member');
    }
  }, [open]);
  const create = async () => {
    setBusy(true);
    try {
      const res = unwrap(await supabase.rpc('create_group_invitation', { p_group_id: groupId, p_role: role, p_max_uses: 25, p_valid_days: 7 })) as { token: string };
      setLink(appUrl(`join/group/${res.token}`));
      void qc.invalidateQueries({ queryKey: qk.groupInvites(groupId) });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Invite people to ${groupName}`} description="Share a private link. It works for up to 25 people for 7 days.">
      {link ? (
        <InviteLinkBox link={link} message={`${me.data?.profile.display_name ?? 'Someone'} invited you to “${groupName}” on Owenil.`} />
      ) : (
        <div className="space-y-4">
          {isAdmin && (
            <Segmented value={role} onChange={setRole} ariaLabel="Role for people who join" options={[{ value: 'member', label: 'Join as member' }, { value: 'admin', label: 'Join as admin' }]} />
          )}
          <Button className="w-full" onClick={create} loading={busy}>
            <UserPlus /> Create invite link
          </Button>
          <p className="text-xs text-fg-subtle">For security, only a fingerprint of the link is stored — copy it now; you can always create another.</p>
        </div>
      )}
    </Dialog>
  );
}
