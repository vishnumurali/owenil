import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookUser, Search, Settings2, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { isAndroidApp } from '@/lib/native-upi';
import { ContactsAccessDenied, openAppSettings, readPhoneContacts } from '@/lib/native-contacts';
import { formatPhone, matchAddressBook, requestFriend, type ContactMatch, type Relation } from '@/data/people';
import { invalidateFinancial, qk } from '@/data/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import { PersonAction } from './AddFriendDialog';
import { InviteTargets } from './InviteTargets';

type State = { step: 'intro' } | { step: 'loading' } | { step: 'denied' } | { step: 'ready'; rows: ContactMatch[] };

const SHOW = 150;

/**
 * Android app: "Find friends from contacts". Reads the phone's contacts (after
 * the user allows it), checks them against Owenil with one-way codes, then
 * lists who's on Owenil (add / accept) and who could be invited.
 */
export default function ContactsPage() {
  useDocumentTitle('Find friends from contacts');
  const qc = useQueryClient();
  const [state, setState] = React.useState<State>({ step: 'intro' });
  const [q, setQ] = React.useState('');
  const [limit, setLimit] = React.useState(SHOW);
  const [inviting, setInviting] = React.useState<ContactMatch | null>(null);
  const [addingAll, setAddingAll] = React.useState(false);

  const check = async () => {
    setState({ step: 'loading' });
    try {
      const rows = await matchAddressBook(await readPhoneContacts());
      setState({ step: 'ready', rows });
    } catch (e) {
      if (e instanceof ContactsAccessDenied) setState({ step: 'denied' });
      else {
        toast.error(errorMessage(e));
        setState({ step: 'intro' });
      }
    }
  };

  const setRelation = (userId: string, relation: Relation) =>
    setState((s) => (s.step !== 'ready' ? s : { step: 'ready', rows: s.rows.map((r) => (r.person?.user_id === userId ? { ...r, person: { ...r.person, relation } } : r)) }));

  if (!isAndroidApp()) {
    return (
      <Screen>
        <p className="text-sm text-fg-muted">Finding friends from your phone’s contacts works in the Owenil Android app. Here, use “Add friend” with an email or phone number.</p>
        <Button asChild variant="outline"><Link to="/friends">Back to friends</Link></Button>
      </Screen>
    );
  }

  if (state.step === 'intro' || state.step === 'loading') {
    return (
      <Screen>
        <div className="flex size-16 items-center justify-center rounded-3xl bg-primary-soft text-primary">
          <BookUser className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Find friends from your contacts</h1>
          <p className="text-sm text-fg-muted">See which of your contacts already use Owenil and add them in one tap. Invite the rest by WhatsApp or SMS.</p>
        </div>
        <p className="flex gap-2 rounded-2xl bg-muted/60 p-3 text-xs text-fg-muted">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          Numbers and emails are turned into one-way codes on your phone before checking. Owenil never uploads or stores your contacts.
        </p>
        <Button size="lg" className="w-full" loading={state.step === 'loading'} onClick={() => void check()}>
          {state.step === 'loading' ? 'Checking your contacts…' : 'Allow contacts and check'}
        </Button>
      </Screen>
    );
  }

  if (state.step === 'denied') {
    return (
      <Screen>
        <h1 className="text-2xl font-semibold">Contacts access is off</h1>
        <p className="text-sm text-fg-muted">To find friends from your contacts, allow Owenil to read contacts in Android settings (Permissions → Contacts), then try again.</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void openAppSettings()}><Settings2 /> Open settings</Button>
          <Button onClick={() => void check()}>Try again</Button>
        </div>
      </Screen>
    );
  }

  const needle = q.trim().toLowerCase();
  const match = (r: ContactMatch) =>
    !needle || [r.name, r.person?.display_name, r.phone, r.email].some((v) => v?.toLowerCase().includes(needle));
  const onOwenil = state.rows.filter((r) => r.person && match(r));
  const others = state.rows.filter((r) => !r.person && match(r));
  const addable = onOwenil.filter((r) => r.person!.relation === 'none' || r.person!.relation === 'incoming');

  const addAll = async () => {
    setAddingAll(true);
    let added = 0;
    for (const r of addable) {
      try {
        const res = await requestFriend(r.person!.user_id);
        setRelation(r.person!.user_id, res === 'friends' ? 'friend' : 'requested');
        added++;
      } catch (e) {
        toast.error(errorMessage(e));
        break;
      }
    }
    setAddingAll(false);
    if (added) toast.success(`Sent ${added} friend request${added === 1 ? '' : 's'}`);
    void qc.invalidateQueries({ queryKey: qk.friends });
    void qc.invalidateQueries({ queryKey: qk.contacts });
    invalidateFinancial(qc);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 pb-3">
        <Link to="/friends" className="inline-flex items-center gap-1 text-sm text-fg-muted"><ArrowLeft className="size-4" /> Friends</Link>
        <h1 className="text-xl font-semibold">{state.rows.filter((r) => r.person).length} of your contacts are on Owenil</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contacts" aria-label="Search contacts" className="pl-9" />
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain pb-4">
        {onOwenil.length > 0 && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">On Owenil</h2>
              {addable.length > 1 && (
                <Button size="sm" variant="outline" loading={addingAll} onClick={() => void addAll()}><UserPlus /> Add all ({addable.length})</Button>
              )}
            </div>
            <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
              {onOwenil.map((r) => (
                <li key={r.person!.user_id} className="flex items-center gap-3 p-3">
                  <Avatar name={r.person!.display_name} color={r.person!.avatar_color} url={r.person!.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.person!.display_name}</p>
                    <p className="truncate text-xs text-fg-subtle">{r.name}</p>
                  </div>
                  <PersonAction person={r.person!} onChange={(rel) => setRelation(r.person!.user_id, rel)} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Invite to Owenil · {others.length}</h2>
          {others.length === 0 ? (
            <p className="text-sm text-fg-muted">No one else to invite{needle ? ' with that name' : ''}.</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
              {others.slice(0, limit).map((r) => (
                <li key={`${r.phone ?? ''}|${r.email ?? ''}`} className="flex items-center gap-3 p-3">
                  <Avatar name={r.name || '?'} color="#94a3b8" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.name || 'Contact'}</p>
                    <p className="truncate text-xs text-fg-subtle">Not registered · {r.phone ? formatPhone(r.phone) : r.email}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setInviting(r)}>Invite</Button>
                </li>
              ))}
            </ul>
          )}
          {others.length > limit && (
            <Button variant="ghost" className="mt-2 w-full" onClick={() => setLimit((l) => l + SHOW)}>Show more</Button>
          )}
        </section>
      </div>
      <Dialog open={!!inviting} onOpenChange={(o) => !o && setInviting(null)} title={`Invite ${inviting?.name || 'contact'}`} description="They’re not on Owenil yet.">
        {inviting && <InviteTargets name={inviting.name} phone={inviting.phone} email={inviting.email} />}
      </Dialog>
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-5 py-4">{children}</div>;
}
