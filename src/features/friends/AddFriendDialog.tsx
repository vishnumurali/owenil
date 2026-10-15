import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Search, UserCheck, UserPlus, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';
import { findPeople, formatPhone, parseContactInput, requestFriend, type ContactKey, type FoundPerson, type Relation } from '@/data/people';
import { invalidateFinancial, qk } from '@/data/queries';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/misc';
import { InviteTargets } from './InviteTargets';

/**
 * The right action for a person found by email or phone: add (or accept their
 * request), or a note that you're already friends / already asked.
 */
export function PersonAction({ person, onChange }: { person: FoundPerson; onChange: (relation: Relation) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = React.useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const result = await requestFriend(person.user_id);
      onChange(result === 'friends' ? 'friend' : 'requested');
      toast.success(result === 'friends' ? `You and ${person.display_name} are now friends` : `Friend request sent to ${person.display_name}`);
      void qc.invalidateQueries({ queryKey: qk.friends });
      void qc.invalidateQueries({ queryKey: qk.contacts });
      invalidateFinancial(qc);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  switch (person.relation) {
    case 'friend':
      return <Badge tone="positive"><UserCheck /> Friends</Badge>;
    case 'requested':
      return <Badge><Clock /> Request sent</Badge>;
    case 'self':
      return <Badge>That’s you</Badge>;
    case 'incoming':
      return <Button size="sm" loading={busy} onClick={() => void add()}><Check /> Accept</Button>;
    default:
      return <Button size="sm" loading={busy} onClick={() => void add()}><UserPlus /> Add</Button>;
  }
}

type Result = { key: ContactKey; person: FoundPerson | null };

/** "Add friend": look someone up by email or phone number; add them if they're on Owenil, otherwise invite them. */
export function AddFriendDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [input, setInput] = React.useState('');
  const [result, setResult] = React.useState<Result | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setInput('');
      setResult(null);
      setError(null);
    }
  }, [open]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    const key = parseContactInput(input);
    if (!key) {
      return setError(input.includes('@') ? 'Enter a valid email address.' : 'Enter an email, or a mobile number like +91 98765 43210.');
    }
    setBusy(true);
    try {
      const found = await findPeople([key.value]);
      setResult({ key, person: found.get(key.value) ?? null });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = result ? (result.key.kind === 'phone' ? formatPhone(result.key.value) : result.key.value) : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a friend" description="Find someone on Owenil by their email or phone number.">
      <form onSubmit={search} className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Email or phone number"
          aria-label="Email or phone number"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          className="flex-1"
        />
        <Button type="submit" loading={busy}>
          <Search /> Find
        </Button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-negative">{error}</p>}

      {result?.person && (
        <div className="mt-4 flex items-center gap-3 tile rounded-[22px] p-3" data-testid="person-found">
          <Avatar name={result.person.display_name} color={result.person.avatar_color} url={result.person.avatar_url} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{result.person.display_name}</p>
            <p className="truncate text-xs text-positive">On Owenil · {shown}</p>
          </div>
          {result.person.relation === 'friend' ? (
            <Button size="sm" variant="outline" asChild onClick={() => onOpenChange(false)}>
              <Link to={`/friends/${result.person.user_id}`}>Open</Link>
            </Button>
          ) : (
            <PersonAction person={result.person} onChange={(relation) => setResult({ ...result, person: { ...result.person!, relation } })} />
          )}
        </div>
      )}

      {result && !result.person && (
        <div className="mt-4 space-y-3 rounded-2xl border border-dashed border-fg/15 p-4" data-testid="person-not-found">
          <p className="flex items-center gap-2 font-medium">
            <UserX className="size-4 text-fg-subtle" /> Not registered on Owenil
          </p>
          <p className="text-sm text-fg-muted">
            {shown} isn’t on Owenil yet, or doesn’t allow being found. Invite them, and you’ll be friends as soon as they join with your link.
          </p>
          <InviteTargets
            phone={result.key.kind === 'phone' ? result.key.value : null}
            email={result.key.kind === 'email' ? result.key.value : null}
          />
        </div>
      )}
      <p className="mt-4 text-xs text-fg-subtle">
        People on Owenil get a friend request to accept. If you already share a group, or they asked you first, you’re friends straight away.
      </p>
    </Dialog>
  );
}
