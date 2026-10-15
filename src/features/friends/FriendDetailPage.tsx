import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, HandCoins, MoreHorizontal, Plus, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { invalidateFinancial, qk, useBalanceOverview, useCategories, useContacts, useExpenses, useFriends, useGroups, useSettlements, useNameOf } from '@/data/queries';
import { deriveMyEdges } from '@/data/balances';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Badge, Skeleton } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState, SectionTitle } from '@/components/ui/layout-bits';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ExpenseRow, GroupBadge } from '@/components/domain';
import { SettleUpDialog, type SettleDefaults } from '@/features/balances/SettleUpDialog';

export default function FriendDetailPage() {
  const { friendId = '' } = useParams();
  const { user } = useAuth();
  const me = user!.id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const contacts = useContacts();
  const friends = useFriends();
  const groups = useGroups();
  const balances = useBalanceOverview();
  const categories = useCategories();
  const nameOf = useNameOf();
  const [page, setPage] = React.useState(0);
  const expenses = useExpenses({ friendId, page, pageSize: 15 });
  const settlements = useSettlements({ friendId, limit: 20 });
  const [settle, setSettle] = React.useState<SettleDefaults | null>(null);
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const person = contacts.data?.get(friendId);
  useDocumentTitle(person?.display_name ?? 'Friend');
  const isFriend = friends.data?.friendIds.includes(friendId) ?? false;
  const edges = React.useMemo(
    () => (balances.data && groups.data ? deriveMyEdges(balances.data, groups.data, me).filter((e) => e.fromId === friendId || e.toId === friendId) : []),
    [balances.data, groups.data, me, friendId],
  );
  const catMap = React.useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const totals = new Map<string, number>();
  for (const e of edges) totals.set(e.currency, (totals.get(e.currency) ?? 0) + (e.toId === me ? e.amountMinor : -e.amountMinor));

  const remove = async () => {
    setBusy(true);
    try {
      unwrap(await supabase.rpc('remove_friend', { p_friend_id: friendId }));
      toast.success('Friend removed');
      void qc.invalidateQueries({ queryKey: qk.friends });
      invalidateFinancial(qc);
      navigate('/friends');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  if (contacts.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  if (!person) {
    return (
      <Card>
        <EmptyState illustration="friends" title="Person not found" description="They may have removed you, or this link is out of date." action={<Button asChild variant="outline"><Link to="/friends">Back to friends</Link></Button>} />
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link to="/friends" className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Friends
        </Link>
        <Card className="relative overflow-hidden p-6">
          <div className="absolute inset-0 bg-hero-glow" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            <Avatar name={person.display_name} color={person.avatar_color} size="xl" />
            <div className="flex-1">
              <h1 className="text-2xl font-semibold">{person.display_name}</h1>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {isFriend ? <Badge tone="primary">Friend</Badge> : <Badge>Group member</Badge>}
                {person.is_demo && <Badge tone="warning">Demo</Badge>}
                {person.deleted_at && <Badge tone="negative">Account deleted</Badge>}
              </div>
              <div className="mt-3 space-y-0.5">
                {totals.size === 0 ? (
                  <p className="text-sm text-fg-muted">You’re all settled up.</p>
                ) : (
                  [...totals.entries()].map(([c, v]) => (
                    <p key={c} className={`text-lg font-semibold ${v > 0 ? 'text-positive' : 'text-negative'}`}>
                      {v > 0 ? `${person.display_name} owes you ` : `You owe ${person.display_name} `}
                      <span className="tabular">{formatMoney(Math.abs(v), c)}</span>
                    </p>
                  ))
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {isFriend && (
                <Button asChild>
                  <Link to={`/expenses/new?friend=${friendId}`}>
                    <Plus /> Add expense
                  </Link>
                </Button>
              )}
              {isFriend && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="More actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem destructive onSelect={() => setConfirmRemove(true)}>
                      <UserMinus /> Remove friend
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </Card>
      </div>

      {edges.length > 0 && (
        <section>
          <SectionTitle>Balances</SectionTitle>
          <Card className="divide-y divide-border">
            {edges.map((e, i) => {
              const g = groups.data?.find((x) => x.id === e.groupId);
              const theyOwe = e.toId === me;
              return (
                <div key={i} className="flex flex-wrap items-center gap-3 p-4">
                  {g ? <GroupBadge emoji={g.emoji} color={g.color} size="sm" /> : <span className="flex size-8 items-center justify-center rounded-lg bg-fg/[0.06] text-xs">1:1</span>}
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium">{g ? g.name : 'Non-group expenses'}</p>
                    <p className={theyOwe ? 'text-positive' : 'text-negative'}>
                      {theyOwe ? `${person.display_name} owes you` : `You owe ${person.display_name}`}{' '}
                      <span className="tabular font-semibold">{formatMoney(e.amountMinor, e.currency)}</span>
                      {g?.simplify_debts && <span className="text-xs text-fg-subtle"> · simplified</span>}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setSettle({ groupId: e.groupId, payerId: e.fromId, payeeId: e.toId, amountMinor: e.amountMinor, currency: e.currency })}>
                    <HandCoins /> Settle
                  </Button>
                </div>
              );
            })}
          </Card>
        </section>
      )}

      <section>
        <SectionTitle>Shared expenses</SectionTitle>
        <Card className="p-2">
          {expenses.isLoading ? (
            <div className="space-y-2 p-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : expenses.data?.rows.length ? (
            <>
              {expenses.data.rows.map((e) => (
                <ExpenseRow key={e.id} expense={e} categories={catMap} groupName={groups.data?.find((g) => g.id === e.group_id)?.name} />
              ))}
              {expenses.data.count > 15 && (
                <div className="flex items-center justify-between p-2 text-sm">
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <span className="text-fg-muted">Page {page + 1} of {Math.ceil(expenses.data.count / 15)}</span>
                  <Button size="sm" variant="ghost" disabled={(page + 1) * 15 >= expenses.data.count} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              )}
            </>
          ) : (
            <EmptyState title="Nothing shared yet" description={`Expenses you share with ${person.display_name} appear here.`} />
          )}
        </Card>
      </section>

      {settlements.data && settlements.data.length > 0 && (
        <section>
          <SectionTitle>Repayments</SectionTitle>
          <Card className="divide-y divide-border">
            {settlements.data.map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-4 text-sm">
                <HandCoins className="size-4 text-positive" />
                <span className={`flex-1 ${s.reversed_at ? 'line-through opacity-60' : ''}`}>
                  {nameOf(s.payer_id)} paid {nameOf(s.payee_id)} · {formatDate(s.settled_on)}
                </span>
                {s.reversed_at && <Badge tone="negative">Reversed</Badge>}
                <span className="tabular font-semibold">{formatMoney(Number(s.amount_minor), s.currency)}</span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <SettleUpDialog open={!!settle} onOpenChange={(o) => !o && setSettle(null)} defaults={settle ?? {}} />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${person.display_name}?`}
        description="You’ll no longer be able to add non-group expenses together. Shared groups and past expenses are not affected. Non-group balances must be settled first."
        confirmLabel="Remove friend"
        destructive
        loading={busy}
        onConfirm={remove}
      />
    </div>
  );
}
