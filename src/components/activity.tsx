import { Link } from 'react-router-dom';
import { formatMoney } from '@owenil/core';
import { formatRelative } from '@/lib/utils';
import type { ActivityEvent } from '@/types/db';
import { useContacts } from '@/data/queries';
import { useAuth } from '@/features/auth/AuthProvider';
import { Avatar } from './ui/avatar';

export function useDescribeActivity() {
  const { data: contacts } = useContacts();
  const { user } = useAuth();
  const n = (id: unknown) => (id === user?.id ? 'you' : contacts?.get(String(id))?.display_name ?? 'someone');
  return (e: ActivityEvent): { text: string; link: string | null } => {
    const s = e.summary as Record<string, unknown>;
    const amt = typeof s.amount_minor === 'number' && typeof s.currency === 'string' ? formatMoney(s.amount_minor, s.currency) : '';
    const actor = n(e.actor_id);
    const Actor = actor.charAt(0).toUpperCase() + actor.slice(1);
    switch (e.event_type) {
      case 'expense_created':
        return { text: `${Actor} added “${s.description}” (${amt})`, link: `/expenses/${e.entity_id}` };
      case 'expense_updated':
        return { text: `${Actor} edited “${s.description}” — now ${amt}`, link: `/expenses/${e.entity_id}` };
      case 'expense_deleted':
        return { text: `${Actor} deleted “${s.description}” (${amt})`, link: `/expenses/${e.entity_id}` };
      case 'expense_restored':
        return { text: `${Actor} restored “${s.description}”`, link: `/expenses/${e.entity_id}` };
      case 'settlement_recorded':
        return { text: `${Actor} recorded: ${n(s.payer_id)} paid ${n(s.payee_id)} ${amt}`, link: '/settlements' };
      case 'settlement_reversed':
        return { text: `${Actor} reversed a ${amt} repayment`, link: '/settlements' };
      case 'group_created':
        return { text: `${Actor} created the group “${s.name}”`, link: e.group_id ? `/groups/${e.group_id}` : null };
      case 'member_added':
        return { text: `${Actor} added ${n(s.user_id)}`, link: e.group_id ? `/groups/${e.group_id}` : null };
      case 'member_joined':
        return { text: `${Actor} joined via an invitation link`, link: e.group_id ? `/groups/${e.group_id}` : null };
      case 'member_left':
        return { text: `${Actor} left the group`, link: e.group_id ? `/groups/${e.group_id}` : null };
      case 'member_removed':
        return { text: `${Actor} removed ${n(s.user_id)}`, link: e.group_id ? `/groups/${e.group_id}` : null };
      case 'member_role_changed':
        return { text: `${Actor} made ${n(s.user_id)} ${s.role === 'owner' ? 'the owner' : `an ${s.role}`}`, link: e.group_id ? `/groups/${e.group_id}` : null };
      case 'group_archived':
        return { text: `${Actor} archived the group`, link: e.group_id ? `/groups/${e.group_id}` : null };
      case 'group_unarchived':
        return { text: `${Actor} unarchived the group`, link: e.group_id ? `/groups/${e.group_id}` : null };
      case 'friend_added':
        return {
          text: e.actor_id === user?.id ? `You are now friends with ${n(e.entity_id)}` : `${Actor} is now your friend`,
          link: '/friends',
        };
      case 'recurring_created':
        return { text: `${Actor} set up a recurring expense: “${s.description}”`, link: '/recurring' };
      case 'recurring_paused':
      case 'recurring_active':
      case 'recurring_cancelled':
        return { text: `${Actor} ${e.event_type === 'recurring_active' ? 'resumed' : e.event_type.replace('recurring_', '')} “${s.description}”`, link: '/recurring' };
      default:
        return { text: `${Actor}: ${e.event_type.replace(/_/g, ' ')}`, link: null };
    }
  };
}

export function ActivityList({ events, compact }: { events: ActivityEvent[]; compact?: boolean }) {
  const describe = useDescribeActivity();
  const { data: contacts } = useContacts();
  return (
    <ol className="space-y-1">
      {events.map((e) => {
        const d = describe(e);
        const p = e.actor_id ? contacts?.get(e.actor_id) : null;
        const inner = (
          <>
            <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} size="sm" />
            <div className="min-w-0 flex-1">
              <p className={compact ? 'line-clamp-2 text-sm' : 'text-sm'}>{d.text}</p>
              <p className="text-xs text-fg-subtle">{formatRelative(e.created_at)}</p>
            </div>
          </>
        );
        return (
          <li key={e.id}>
            {d.link ? (
              <Link to={d.link} className="flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-fg/[0.05]">
                {inner}
              </Link>
            ) : (
              <div className="flex items-start gap-3 px-2 py-2">{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
