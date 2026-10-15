import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bell, CalendarClock, CheckCheck, HandCoins, Receipt, Trash2, UserPlus, Users, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { cn, formatRelative } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { qk, useNotifications } from '@/data/queries';
import type { Notification } from '@/types/db';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState, FitBody, FitScreen, PageHeader } from '@/components/ui/layout-bits';

function iconFor(kind: string) {
  if (kind.startsWith('expense') || kind.startsWith('recurring_expense')) return Receipt;
  if (kind.startsWith('settlement')) return HandCoins;
  if (kind.startsWith('friend')) return UserPlus;
  if (kind.startsWith('group')) return Users;
  if (kind.startsWith('budget')) return Wallet;
  if (kind === 'recurring_failed') return AlertTriangle;
  if (kind.startsWith('recurring')) return CalendarClock;
  return Bell;
}

export default function NotificationsPage() {
  useDocumentTitle('Notifications');
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const notifications = useNotifications();
  const unread = notifications.data?.filter((n) => !n.read_at) ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: qk.notifications });
  const markAll = async () => {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user!.id).is('read_at', null);
    if (error) toast.error(errorMessage(error));
    refresh();
  };
  const open = async (n: Notification) => {
    if (!n.read_at) await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
    refresh();
    if (n.link) navigate(n.link);
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) toast.error(errorMessage(error));
    refresh();
  };

  return (
    <FitScreen>
      <PageHeader
        title="Notifications"
        description={unread.length ? `${unread.length} unread` : 'You’re all caught up'}
        actions={
          <>
            <Button variant="outline" asChild><Link to="/settings#notifications">Preferences</Link></Button>
            <Button variant="outline" onClick={markAll} disabled={!unread.length}><CheckCheck /> Mark all read</Button>
          </>
        }
      />
      <FitBody>
      <Card className="divide-y divide-border">
        {notifications.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : notifications.isError ? (
          <ErrorState error={notifications.error} onRetry={() => notifications.refetch()} />
        ) : notifications.data?.length ? (
          notifications.data.map((n) => {
            const Icon = iconFor(n.kind);
            return (
              <div key={n.id} className={cn('group flex items-start gap-3 p-4 transition-colors', !n.read_at && 'bg-primary-soft/40')}>
                <span className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl', n.kind.includes('failed') || n.kind === 'budget_over' ? 'bg-negative-soft text-negative' : 'bg-fg/[0.06] text-fg-muted')}>
                  <Icon className="size-4" />
                </span>
                <button className="min-w-0 flex-1 text-left" onClick={() => open(n)}>
                  <p className={cn('text-sm', !n.read_at && 'font-semibold')}>{n.title}</p>
                  {n.body && <p className="text-sm text-fg-muted">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-fg-subtle">{formatRelative(n.created_at)}</p>
                </button>
                {!n.read_at && <span className="mt-2 size-2 rounded-full bg-primary" aria-label="Unread" />}
                <Button size="icon-sm" variant="ghost" className="opacity-60 group-hover:opacity-100" aria-label="Delete notification" onClick={() => remove(n.id)}><Trash2 /></Button>
              </div>
            );
          })
        ) : (
          <EmptyState illustration="notifications" title="No notifications" description="We’ll let you know when friends add expenses, record repayments or invite you." />
        )}
      </Card>
      </FitBody>
    </FitScreen>
  );
}
