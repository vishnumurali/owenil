import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { invalidateFinancial, qk } from '@/data/queries';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState } from '@/components/ui/layout-bits';
import { GroupBadge } from '@/components/domain';

interface Preview {
  valid: boolean;
  reason: string | null;
  group_name?: string;
  group_emoji?: string;
  group_color?: string;
  member_count?: number;
  inviter_name?: string;
  already_member?: boolean;
  already_friends?: boolean;
  group_id?: string | null;
}

const REASONS: Record<string, string> = {
  not_found: 'This invitation link isn’t valid. Check that you copied all of it.',
  expired: 'This invitation has expired. Ask for a new link.',
  revoked: 'This invitation was revoked.',
  used_up: 'This link has reached its limit. Ask for a new one.',
  archived: 'This group is no longer active.',
  accepted: 'This invitation was already used.',
  declined: 'This invitation was declined.',
  own_invitation: 'This is your own invitation link — share it with someone else.',
};

export default function JoinPage() {
  const { kind = '', token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  useDocumentTitle('Invitation');
  const preview = useQuery({
    queryKey: ['invite-preview', kind, token],
    queryFn: async () => unwrap(await supabase.rpc('preview_invitation', { p_kind: kind, p_token: token })) as Preview,
  });

  const accept = async () => {
    setBusy(true);
    try {
      if (kind === 'group') {
        const gid = unwrap(await supabase.rpc('accept_group_invitation', { p_token: token })) as string;
        toast.success(`Welcome to ${preview.data?.group_name}!`);
        invalidateFinancial(qc);
        navigate(`/groups/${gid}`, { replace: true });
      } else {
        const friendId = unwrap(await supabase.rpc('accept_friend_invitation', { p_token: token })) as string;
        toast.success(`You and ${preview.data?.inviter_name} are now friends`);
        void qc.invalidateQueries({ queryKey: qk.friends });
        void qc.invalidateQueries({ queryKey: qk.contacts });
        navigate(`/friends/${friendId}`, { replace: true });
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (preview.isLoading) return <Skeleton className="mx-auto h-72 max-w-md rounded-2xl" />;
  const p = preview.data;
  if (preview.isError || !p) return <Card className="mx-auto max-w-md"><EmptyState illustration="error" title="Couldn’t open this invitation" description={errorMessage(preview.error)} /></Card>;

  if (kind === 'group' && p.already_member && p.group_id) {
    return (
      <Card className="mx-auto max-w-md">
        <EmptyState illustration="groups" title={`You’re already in ${p.group_name}`} action={<Button asChild><Link to={`/groups/${p.group_id}`}>Open group</Link></Button>} />
      </Card>
    );
  }
  if (kind === 'friend' && p.already_friends) {
    return (
      <Card className="mx-auto max-w-md">
        <EmptyState illustration="friends" title={`You’re already friends with ${p.inviter_name}`} action={<Button asChild><Link to="/friends">Go to friends</Link></Button>} />
      </Card>
    );
  }
  if (!p.valid) {
    return (
      <Card className="mx-auto max-w-md">
        <EmptyState illustration="error" title="This invitation can’t be used" description={REASONS[p.reason ?? 'not_found'] ?? REASONS.not_found} action={<Button asChild variant="outline"><Link to="/dashboard">Go to dashboard</Link></Button>} />
      </Card>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto max-w-md">
      <Card className="relative overflow-hidden p-8 text-center">
        <div className="absolute inset-0 bg-hero-glow" />
        <div className="relative">
          {kind === 'group' ? (
            <>
              <div className="mb-4 flex justify-center">
                <GroupBadge emoji={p.group_emoji ?? '✨'} color={p.group_color ?? '#14b8a6'} size="lg" />
              </div>
              <p className="text-sm text-fg-muted">{p.inviter_name} invited you to join</p>
              <h1 className="mt-1 text-2xl font-semibold">{p.group_name}</h1>
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-fg-muted">
                <Users className="size-4" /> {p.member_count} member{p.member_count === 1 ? '' : 's'}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-fg-muted">Friend invitation</p>
              <h1 className="mt-1 text-2xl font-semibold">{p.inviter_name} wants to split expenses with you</h1>
            </>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <Button size="lg" onClick={accept} loading={busy}>
              {kind === 'group' ? 'Join group' : 'Accept invitation'}
            </Button>
            <Button variant="ghost" asChild>
              <Link to="/dashboard">Not now</Link>
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
