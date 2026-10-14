import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Mail, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { emailSchema } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { appUrl } from '@/lib/env';
import { errorMessage, unwrap } from '@/lib/errors';
import { qk, useMe } from '@/data/queries';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export function InviteLinkBox({ link, message }: { link: string; message: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Couldn’t copy — select the link and copy it manually.');
    }
  };
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 p-2 pl-3">
        <Link2 className="size-4 shrink-0 text-fg-subtle" />
        <input readOnly value={link} className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
        <Button size="sm" variant={copied ? 'secondary' : 'primary'} onClick={copy}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {canShare && (
          <Button variant="outline" size="sm" onClick={() => navigator.share({ title: 'Owenil invitation', text: message, url: link }).catch(() => undefined)}>
            <Share2 /> Share…
          </Button>
        )}
        <Button variant="outline" size="sm" asChild>
          <a href={`mailto:?subject=${encodeURIComponent('Join me on Owenil')}&body=${encodeURIComponent(`${message}\n\n${link}`)}`}>
            <Mail /> Email
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={`https://wa.me/?text=${encodeURIComponent(`${message} ${link}`)}`} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        </Button>
      </div>
      <p className="text-xs text-fg-subtle">Anyone with this link can accept it until it expires. Owenil doesn’t send emails for you — share the link yourself.</p>
    </div>
  );
}

export function InviteFriendDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [link, setLink] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setEmail('');
      setLink(null);
      setError(null);
    }
  }, [open]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (trimmed && !emailSchema.safeParse(trimmed).success) return setError('Enter a valid email or leave it empty.');
    setBusy(true);
    try {
      const res = unwrap(await supabase.rpc('create_friend_invitation', { p_email: trimmed || null })) as { token: string };
      setLink(appUrl(`join/friend/${res.token}`));
      void qc.invalidateQueries({ queryKey: qk.friends });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Invite a friend" description="Friends can share expenses with you outside of groups.">
      {link ? (
        <InviteLinkBox link={link} message={`${me.data?.profile.display_name ?? 'A friend'} invited you to split expenses on Owenil.`} />
      ) : (
        <form onSubmit={create} className="space-y-4">
          <Field label="Their email" htmlFor="invite-email" optional hint="If they already use Owenil, they’ll also see the request in the app.">
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="friend@example.com" autoFocus />
          </Field>
          {error && <p className="text-sm text-negative" role="alert">{error}</p>}
          <Button type="submit" className="w-full" loading={busy}>
            Create invitation link
          </Button>
        </form>
      )}
    </Dialog>
  );
}
