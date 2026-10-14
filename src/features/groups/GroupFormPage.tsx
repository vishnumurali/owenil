import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check } from 'lucide-react';
import { toast } from 'sonner';
import { CURRENCIES, GROUP_TYPES, GROUP_TYPE_LABELS, groupFormSchema, type GroupForm } from '@owenil/core';
import { supabase } from '@/lib/supabase';
import { errorMessage, unwrap } from '@/lib/errors';
import { useDocumentTitle } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/AuthProvider';
import { qk, useContacts, useFriends, useGroup, useMe } from '@/data/queries';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Switch, Skeleton } from '@/components/ui/misc';
import { Avatar } from '@/components/ui/avatar';
import { GroupBadge } from '@/components/domain';

const EMOJIS = ['✨', '✈️', '🏖️', '🏔️', '🏠', '🛋️', '💑', '👨‍👩‍👧', '🍕', '🎉', '🚗', '🎒', '🏕️', '💼', '🎓', '🛒'];
const COLORS = ['#14b8a6', '#10b981', '#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#64748b'];
const TYPE_EMOJI: Record<string, string> = { travel: '✈️', home: '🏠', couple: '💑', family: '👨‍👩‍👧', outing: '🎉', other: '✨' };

export default function GroupFormPage() {
  const { groupId } = useParams();
  const editing = !!groupId;
  useDocumentTitle(editing ? 'Edit group' : 'New group');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const me = useMe();
  const group = useGroup(groupId);
  const friends = useFriends();
  const contacts = useContacts();
  const [members, setMembers] = React.useState<string[]>([]);

  const form = useForm<GroupForm>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { name: '', description: '', group_type: 'travel', default_currency: 'INR', emoji: '✈️', color: '#14b8a6', simplify_debts: true },
  });
  const loaded = React.useRef(false);
  React.useEffect(() => {
    if (editing && group.data && !loaded.current) {
      loaded.current = true;
      const g = group.data;
      form.reset({ name: g.name, description: g.description, group_type: g.group_type, default_currency: g.default_currency, emoji: g.emoji, color: g.color, simplify_debts: g.simplify_debts });
    } else if (!editing && me.data && !loaded.current) {
      loaded.current = true;
      form.setValue('default_currency', me.data.profile.default_currency);
    }
  }, [editing, group.data, me.data, form]);

  const emoji = form.watch('emoji');
  const color = form.watch('color');
  const type = form.watch('group_type');

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (editing) {
        const { data, error } = await supabase
          .from('groups')
          .update({ name: v.name, description: v.description, group_type: v.group_type, default_currency: v.default_currency, emoji: v.emoji, color: v.color, simplify_debts: v.simplify_debts })
          .eq('id', groupId!)
          .select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Only group admins can edit group settings.');
        toast.success('Group updated');
        void qc.invalidateQueries({ queryKey: qk.groups });
        void qc.invalidateQueries({ queryKey: qk.group(groupId!) });
        navigate(`/groups/${groupId}`);
      } else {
        const id = unwrap(
          await supabase.rpc('create_group', {
            p_name: v.name, p_description: v.description ?? '', p_group_type: v.group_type, p_currency: v.default_currency,
            p_emoji: v.emoji, p_color: v.color, p_simplify: v.simplify_debts, p_member_ids: members,
          }),
        ) as string;
        toast.success('Group created');
        void qc.invalidateQueries({ queryKey: qk.groups });
        void qc.invalidateQueries({ queryKey: qk.contacts });
        navigate(`/groups/${id}?invite=1`);
      }
    } catch (e) {
      form.setError('root', { message: errorMessage(e) });
    }
  });

  if (editing && group.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  const err = form.formState.errors;
  const friendIds = (friends.data?.friendIds ?? []).filter((f) => f !== user?.id);

  return (
    <div className="mx-auto max-w-2xl">
      <Link to={editing ? `/groups/${groupId}` : '/groups'} className="mb-4 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back
      </Link>
      <h1 className="mb-6 text-2xl font-semibold">{editing ? 'Edit group' : 'Create a group'}</h1>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <Card className="space-y-5 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <GroupBadge emoji={emoji ?? '✨'} color={color ?? '#14b8a6'} size="lg" />
            <Field label="Group name" htmlFor="name" error={err.name?.message} className="flex-1">
              <Input id="name" autoFocus placeholder="e.g. Goa trip 2026" aria-invalid={!!err.name} {...form.register('name')} />
            </Field>
          </div>
          <Field label="Type" htmlFor="type">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Group type">
              {GROUP_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  onClick={() => {
                    form.setValue('group_type', t);
                    if (!editing) form.setValue('emoji', TYPE_EMOJI[t] ?? '✨');
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium transition-all',
                    type === t ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-muted',
                  )}
                >
                  <span className="text-xl">{TYPE_EMOJI[t]}</span>
                  {GROUP_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Description" htmlFor="description" optional error={err.description?.message}>
            <Textarea id="description" rows={2} maxLength={280} placeholder="What is this group for?" {...form.register('description')} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Icon">
              <div className="flex flex-wrap gap-1.5">
                {EMOJIS.map((e) => (
                  <button key={e} type="button" onClick={() => form.setValue('emoji', e)} aria-label={`Icon ${e}`} aria-pressed={emoji === e}
                    className={cn('flex size-9 items-center justify-center rounded-lg text-lg transition-all', emoji === e ? 'bg-primary-soft ring-2 ring-primary' : 'hover:bg-muted')}>
                    {e}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Colour">
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => form.setValue('color', c)} aria-label={`Colour ${c}`} aria-pressed={color === c}
                    className="flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110"
                    style={{ background: c, boxShadow: color === c ? `0 0 0 2px hsl(var(--surface)), 0 0 0 4px ${c}` : undefined }}>
                    {color === c && <Check className="size-4 text-white" />}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Default currency" htmlFor="currency" hint="New expenses start in this currency. Each expense can use its own.">
            <NativeSelect id="currency" {...form.register('default_currency')}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Controller
            control={form.control}
            name="simplify_debts"
            render={({ field }) => (
              <label className="flex items-start justify-between gap-4 rounded-xl bg-muted/50 p-4">
                <span>
                  <span className="block text-sm font-medium">Simplify debts</span>
                  <span className="block text-xs text-fg-muted">Suggest the fewest repayments that settle everyone. Each person’s total stays exactly the same.</span>
                </span>
                <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Simplify debts" />
              </label>
            )}
          />
        </Card>

        {!editing && (
          <Card className="p-5 sm:p-6">
            <h2 className="font-semibold">Add friends</h2>
            <p className="mb-4 text-sm text-fg-muted">Friends can be added now. Anyone else can join with an invite link after you create the group.</p>
            {friendIds.length === 0 ? (
              <p className="rounded-xl bg-muted/50 p-4 text-sm text-fg-muted">No friends yet — you’ll get an invite link on the next screen.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {friendIds.map((id) => {
                  const p = contacts.data?.get(id);
                  const on = members.includes(id);
                  return (
                    <button key={id} type="button" aria-pressed={on} onClick={() => setMembers((m) => (on ? m.filter((x) => x !== id) : [...m, id]))}
                      className={cn('inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-all', on ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:bg-muted')}>
                      <Avatar name={p?.display_name ?? '?'} color={p?.avatar_color} size="xs" />
                      {p?.display_name ?? 'Friend'}
                      {on && <Check className="size-3.5" />}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        {err.root && <p role="alert" className="rounded-xl bg-negative-soft px-4 py-3 text-sm text-negative">{err.root.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" loading={form.formState.isSubmitting}>{editing ? 'Save changes' : 'Create group'}</Button>
        </div>
      </form>
    </div>
  );
}
