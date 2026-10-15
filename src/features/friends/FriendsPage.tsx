import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BookUser, Check, ChevronRight, Clock, Link2, Search, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { formatDate, formatRelative } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { invalidateFinancial, qk, useBalanceOverview, useContacts, useFriends, useGroups } from '@/data/queries';
import { byCounterparty, deriveMyEdges } from '@/data/balances';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Badge, Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState, FitBody, FitScreen, PageHeader, SectionTitle, Stagger, StaggerItem } from '@/components/ui/layout-bits';
import { isNativeApp } from '@/lib/native-upi';
import { InviteFriendDialog } from './InviteFriendDialog';
import { AddFriendDialog } from './AddFriendDialog';

export default function FriendsPage() {
  useDocumentTitle('Friends');
  const { user } = useAuth();
  const qc = useQueryClient();
  const friends = useFriends();
  const contacts = useContacts();
  const balances = useBalanceOverview();
  const groups = useGroups();
  const navigate = useNavigate();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const perPerson = React.useMemo(
    () => (balances.data && groups.data && user ? byCounterparty(deriveMyEdges(balances.data, groups.data, user.id), user.id) : new Map<string, Map<string, number>>()),
    [balances.data, groups.data, user],
  );

  const respond = async (id: string, accept: boolean) => {
    setBusyId(id);
    try {
      unwrap(await supabase.rpc('respond_friend_invitation', { p_invitation_id: id, p_accept: accept }));
      toast.success(accept ? 'Friend added' : 'Invitation declined');
      void qc.invalidateQueries({ queryKey: qk.friends });
      invalidateFinancial(qc);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };
  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      unwrap(await supabase.rpc('revoke_friend_invitation', { p_invitation_id: id }));
      toast.success('Invitation revoked');
      void qc.invalidateQueries({ queryKey: qk.friends });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const list = (friends.data?.friendIds ?? [])
    .map((id) => ({ id, p: contacts.data?.get(id) }))
    .filter((f) => !q || (f.p?.display_name ?? '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.p?.display_name ?? '').localeCompare(b.p?.display_name ?? ''));
  // People you share balances with through groups but aren't friends with yet.
  const nonFriends = [...perPerson.keys()].filter((id) => !friends.data?.friendIds.includes(id));

  return (
    <FitScreen>
      <PageHeader
        title="Friends"
        description="Share expenses one-to-one, without creating a group."
        actions={
          <>
            <Button onClick={() => setAddOpen(true)}>
              <UserPlus /> Add friend
            </Button>
            {isNativeApp() && (
              <Button variant="outline" onClick={() => navigate('/friends/contacts')}>
                <BookUser /> From contacts
              </Button>
            )}
            <Button variant="outline" onClick={() => setInviteOpen(true)}>
              <Link2 /> Invite link
            </Button>
          </>
        }
      />

      <div className="relative mb-3 max-w-sm shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search friends" className="pl-9" aria-label="Search friends" />
      </div>

      <FitBody>
      {friends.data && friends.data.incoming.length > 0 && (
        <section className="mb-6">
          <SectionTitle>Friend requests</SectionTitle>
          <Card className="divide-y divide-border">
            {friends.data.incoming.map((i) => {
              const p = contacts.data?.get(i.inviter_id);
              return (
                <div key={i.id} className="flex items-center gap-3 p-4">
                  <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p?.display_name ?? 'Someone'}</p>
                    <p className="text-xs text-fg-muted">wants to be friends · {formatRelative(i.created_at)}</p>
                  </div>
                  <Button size="sm" onClick={() => respond(i.id, true)} loading={busyId === i.id}>
                    <Check /> Accept
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Decline" onClick={() => respond(i.id, false)} disabled={busyId === i.id}>
                    <X />
                  </Button>
                </div>
              );
            })}
          </Card>
        </section>
      )}

      {friends.isError ? (
        <ErrorState error={friends.error} onRetry={() => friends.refetch()} />
      ) : friends.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : list.length === 0 && !q ? (
        <Card>
          <EmptyState
            illustration="friends"
            title="No friends yet"
            description="Invite someone with a private link. Once they accept, you can split expenses without a group."
            action={<Button onClick={() => setInviteOpen(true)}><UserPlus /> Invite a friend</Button>}
          />
        </Card>
      ) : (
        <Stagger className="grid gap-3 sm:grid-cols-2">
          {list.map(({ id, p }) => {
            const bal = [...(perPerson.get(id)?.entries() ?? [])];
            return (
              <StaggerItem key={id}>
                <Link to={`/friends/${id}`} className="flex items-center gap-3 tile rounded-[22px] p-4 transition-all hover:-translate-y-0.5 hover:shadow-lift">
                  <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p?.display_name ?? 'Friend'}</p>
                    {bal.length === 0 ? (
                      <p className="text-xs text-fg-subtle">settled up</p>
                    ) : (
                      bal.map(([c, v]) => (
                        <p key={c} className={`text-xs ${v > 0 ? 'text-positive' : 'text-negative'}`}>
                          {v > 0 ? 'owes you ' : 'you owe '}
                          <span className="tabular font-semibold">{formatMoney(Math.abs(v), c)}</span>
                        </p>
                      ))
                    )}
                  </div>
                  <ChevronRight className="size-4 text-fg-subtle" />
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      {nonFriends.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Group balances with others</SectionTitle>
          <Card className="divide-y divide-border">
            {nonFriends.map((id) => {
              const p = contacts.data?.get(id);
              return (
                <Link key={id} to={`/friends/${id}`} className="flex items-center gap-3 p-4 hover:bg-fg/[0.05]">
                  <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} size="sm" />
                  <span className="flex-1 text-sm">{p?.display_name ?? 'Member'}</span>
                  {[...(perPerson.get(id)?.entries() ?? [])].map(([c, v]) => (
                    <span key={c} className={`tabular text-sm font-semibold ${v > 0 ? 'text-positive' : 'text-negative'}`}>
                      {formatMoney(v, c, { signDisplay: 'exceptZero' })}
                    </span>
                  ))}
                </Link>
              );
            })}
          </Card>
        </section>
      )}

      {friends.data && friends.data.outgoing.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Pending invitations you sent</SectionTitle>
          <Card className="divide-y divide-border">
            {friends.data.outgoing.map((i) => (
              <div key={i.id} className="flex items-center gap-3 p-4">
                <span className="flex size-9 items-center justify-center rounded-full bg-fg/[0.06] text-fg-subtle">
                  <Clock className="size-4" />
                </span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">{i.invitee_email ?? (i.invitee_id ? contacts.data?.get(i.invitee_id)?.display_name : null) ?? 'Shareable link'}</p>
                  <p className="text-xs text-fg-subtle">Expires {formatDate(i.expires_at)}</p>
                </div>
                <Badge>pending</Badge>
                <Button size="sm" variant="ghost" onClick={() => revoke(i.id)} loading={busyId === i.id}>
                  Revoke
                </Button>
              </div>
            ))}
          </Card>
        </section>
      )}

      </FitBody>
      <InviteFriendDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <AddFriendDialog open={addOpen} onOpenChange={setAddOpen} />
    </FitScreen>
  );
}
