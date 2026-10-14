import * as React from 'react';
import { Check, Copy, Mail, MessageCircle, MessageSquareText } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { appUrl } from '@/lib/env';
import { errorMessage, unwrap } from '@/lib/errors';
import { isAndroidApp } from '@/lib/native-upi';
import { useMe } from '@/data/queries';
import { Button } from '@/components/ui/button';

/** A link that leaves Owenil (WhatsApp, SMS, email). In the Android app it opens the matching app. */
function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const web = !isAndroidApp() && href.startsWith('http');
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={href} {...(web ? { target: '_blank', rel: 'noreferrer' } : {})}>
        {children}
      </a>
    </Button>
  );
}

/**
 * Invites someone who isn't on Owenil yet: creates a private friend
 * invitation (addressed to their email when known, so it also waits for them
 * after sign-up) and offers WhatsApp / SMS to their number, email, or a copy
 * of the link. Owenil itself never sends these messages.
 */
export function InviteTargets({ name, phone, email }: { name?: string | null; phone?: string | null; email?: string | null }) {
  const me = useMe();
  const [link, setLink] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const res = unwrap(await supabase.rpc('create_friend_invitation', { p_email: email ?? null })) as { token: string };
      setLink(appUrl(`join/friend/${res.token}`));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!link) {
    return (
      <Button className="w-full" loading={busy} onClick={() => void create()}>
        Invite {name || 'them'} to Owenil
      </Button>
    );
  }

  const message = `${me.data?.profile.display_name ?? 'A friend'} invited you to split expenses on Owenil: ${link}`;
  const digits = phone?.replace(/[^0-9]/g, '');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Couldn’t copy. Select the link and copy it yourself.');
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-muted">Your invitation is ready. Send it your way:</p>
      <div className="flex flex-wrap gap-2">
        {digits && (
          <ExternalLink href={`https://wa.me/${digits}?text=${encodeURIComponent(message)}`}>
            <MessageCircle /> WhatsApp
          </ExternalLink>
        )}
        {phone && (
          <ExternalLink href={`sms:${phone}?body=${encodeURIComponent(message)}`}>
            <MessageSquareText /> SMS
          </ExternalLink>
        )}
        {email && (
          <ExternalLink href={`mailto:${email}?subject=${encodeURIComponent('Join me on Owenil')}&body=${encodeURIComponent(message)}`}>
            <Mail /> Email
          </ExternalLink>
        )}
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </div>
  );
}
