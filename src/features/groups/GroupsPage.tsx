import * as React from 'react';
import { Link } from 'react-router-dom';
import { Archive, Plus } from 'lucide-react';
import { formatMoney, GROUP_TYPE_LABELS } from '@owenil/core';
import { useDocumentTitle } from '@/lib/hooks';
import { useAuth } from '@/features/auth/AuthProvider';
import { useBalanceOverview, useContacts, useGroups } from '@/data/queries';
import { deriveMyEdges } from '@/data/balances';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AvatarStack } from '@/components/ui/avatar';
import { Badge, Skeleton } from '@/components/ui/misc';
import { Segmented } from '@/components/ui/segmented';
import { EmptyState, ErrorState, PageHeader, Stagger, StaggerItem } from '@/components/ui/layout-bits';
import { GroupBadge } from '@/components/domain';

export default function GroupsPage() {
  useDocumentTitle('Groups');
  const { user } = useAuth();
  const groups = useGroups();
  const balances = useBalanceOverview();
  const contacts = useContacts();
  const [view, setView] = React.useState<'active' | 'archived'>('active');

  const edges = React.useMemo(() => (balances.data && groups.data && user ? deriveMyEdges(balances.data, groups.data, user.id) : []), [balances.data, groups.data, user]);
  const list = (groups.data ?? []).filter((g) => (view === 'active' ? !g.archived_at : !!g.archived_at));
  const archivedCount = (groups.data ?? []).filter((g) => g.archived_at).length;

  return (
    <div>
      <PageHeader
        title="Groups"
        description="Trips, homes, couples and families — everyone’s share in one place."
        actions={
          <Button asChild>
            <Link to="/groups/new">
              <Plus /> New group
            </Link>
          </Button>
        }
      />
      {archivedCount > 0 && (
        <Segmented
          className="mb-5"
          value={view}
          onChange={setView}
          ariaLabel="Show groups"
          options={[
            { value: 'active', label: 'Active' },
            { value: 'archived', label: <><Archive className="size-3.5" /> Archived ({archivedCount})</> },
          ]}
        />
      )}
      {groups.isError ? (
        <ErrorState error={groups.error} onRetry={() => groups.refetch()} />
      ) : groups.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            illustration="groups"
            title={view === 'active' ? 'Start your first group' : 'No archived groups'}
            description={view === 'active' ? 'A group keeps a running tab for a trip, a flat or a family. Invite people with a private link.' : undefined}
            action={view === 'active' ? <Button asChild><Link to="/groups/new"><Plus /> Create a group</Link></Button> : undefined}
          />
        </Card>
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((g) => {
            const members = g.group_members.filter((m) => m.status === 'active');
            const bal = new Map<string, number>();
            for (const e of edges.filter((x) => x.groupId === g.id)) bal.set(e.currency, (bal.get(e.currency) ?? 0) + (e.toId === user?.id ? e.amountMinor : -e.amountMinor));
            return (
              <StaggerItem key={g.id}>
                <Link
                  to={`/groups/${g.id}`}
                  className="group relative flex h-full flex-col overflow-hidden tile rounded-[22px] p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-lift"
                >
                  <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-35" style={{ background: g.color }} />
                  <div className="flex items-start gap-3">
                    <GroupBadge emoji={g.emoji} color={g.color} />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{g.name}</h3>
                      <p className="text-xs text-fg-muted">{GROUP_TYPE_LABELS[g.group_type]} · {g.default_currency}</p>
                    </div>
                    {g.is_demo && <Badge tone="warning">Demo</Badge>}
                  </div>
                  {g.description && <p className="mt-3 line-clamp-2 text-sm text-fg-muted">{g.description}</p>}
                  <div className="mt-auto flex items-end justify-between pt-5">
                    <AvatarStack people={members.map((m) => ({ name: contacts.data?.get(m.user_id)?.display_name ?? '?', color: contacts.data?.get(m.user_id)?.avatar_color }))} />
                    <div className="text-right">
                      {bal.size === 0 || [...bal.values()].every((v) => v === 0) ? (
                        <span className="text-xs text-fg-subtle">settled up</span>
                      ) : (
                        [...bal.entries()].filter(([, v]) => v !== 0).map(([c, v]) => (
                          <p key={c} className={`text-sm font-semibold ${v > 0 ? 'text-positive' : 'text-negative'}`}>
                            <span className="text-2xs font-normal">{v > 0 ? 'you get back ' : 'you owe '}</span>
                            <span className="tabular">{formatMoney(Math.abs(v), c)}</span>
                          </p>
                        ))
                      )}
                    </div>
                  </div>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}
