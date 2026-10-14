-- =============================================================================
-- Owenil — UPI IDs for paying people back (free; no payment gateway)
--
-- A user may save one UPI ID. Settle-up uses it to open the payer's own UPI app
-- (or show a QR code) with the amount filled in. Owenil never moves money and
-- can't see whether a payment happened; the payer records the repayment.
--
-- Privacy: a UPI ID often contains a phone number, so it is NOT part of the
-- profile row. Only the owner can read the table; other people get it through
-- get_upi_id(), which answers only for current friends and active co-members
-- of a group (people you might owe money to).
-- =============================================================================

create table public.payment_handles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  upi_id text not null check (char_length(upi_id) <= 100 and upi_id ~ '^[a-z0-9][a-z0-9._-]{1,98}@[a-z][a-z0-9]{1,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger payment_handles_updated_at before update on public.payment_handles for each row execute function public.set_updated_at();

alter table public.payment_handles enable row level security;
revoke all on public.payment_handles from public, anon, authenticated;
grant select on public.payment_handles to authenticated;
grant all on public.payment_handles to service_role;
create policy payment_handles_read_own on public.payment_handles for select to authenticated
  using (user_id = (select auth.uid()));

-- Saves the caller's UPI ID. An empty value removes it.
create or replace function public.set_upi_id(p_upi_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._uid();
  v_upi text := lower(btrim(coalesce(p_upi_id, '')));
begin
  if v_upi = '' then
    delete from public.payment_handles where user_id = v_uid;
    return null;
  end if;
  if char_length(v_upi) > 100 or v_upi !~ '^[a-z0-9][a-z0-9._-]{1,98}@[a-z][a-z0-9]{1,63}$' then
    perform public._err('INVALID_UPI_ID', 'Enter a UPI ID like name@bank, for example asha.k@okhdfcbank.');
  end if;
  insert into public.payment_handles (user_id, upi_id) values (v_uid, v_upi)
  on conflict (user_id) do update set upi_id = excluded.upi_id;
  return v_upi;
end $$;

-- The UPI ID of someone the caller may need to pay: themselves, a current
-- friend, or an active member of a group the caller is active in. Null otherwise.
create or replace function public.get_upi_id(p_user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select h.upi_id
    from public.payment_handles h
    join public.profiles p on p.id = h.user_id and p.deleted_at is null
   where h.user_id = p_user_id
     and auth.uid() is not null
     and (p_user_id = auth.uid()
          or public.are_friends(auth.uid(), p_user_id)
          or exists (select 1 from public.group_members a
                       join public.group_members b on b.group_id = a.group_id
                      where a.user_id = auth.uid() and a.status = 'active'
                        and b.user_id = p_user_id and b.status = 'active'));
$$;

-- Deleting an account (profiles.deleted_at set) removes the UPI ID.
create or replace function public._drop_payment_handles_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.payment_handles where user_id = new.id;
  return new;
end $$;
create trigger profiles_drop_payment_handles after update of deleted_at on public.profiles
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function public._drop_payment_handles_on_delete();

-- Data export now includes the UPI ID.
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'notice', 'Owenil data export. Amounts are integer minor units (e.g. paise) of the stated currency.',
    'profile', (select to_jsonb(p) - 'is_tester' from public.profiles p where p.id = v_uid),
    'email', (select email from auth.users where id = v_uid),
    'upi_id', (select h.upi_id from public.payment_handles h where h.user_id = v_uid),
    'preferences', (select to_jsonb(x) from public.user_preferences x where x.user_id = v_uid),
    'subscription', (select to_jsonb(x) from public.subscription_entitlements x where x.user_id = v_uid),
    'friends', coalesce((select jsonb_agg(jsonb_build_object('user_id', case when f.user_a = v_uid then f.user_b else f.user_a end,
                         'name', public._display_name(case when f.user_a = v_uid then f.user_b else f.user_a end), 'since', f.created_at, 'removed_at', f.removed_at))
                         from public.friendships f where v_uid in (f.user_a, f.user_b)), '[]'),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group', to_jsonb(g) - 'default_split', 'role', m.role, 'status', m.status, 'joined_at', m.joined_at))
                        from public.group_members m join public.groups g on g.id = m.group_id where m.user_id = v_uid), '[]'),
    'expenses', coalesce((select jsonb_agg(public._expense_snapshot(e.id) order by e.expense_date)
                          from public.expenses e where e.id in (select x.expense_id from public.expense_participants x where x.user_id = v_uid
                                                                union select x.expense_id from public.expense_payers x where x.user_id = v_uid)), '[]'),
    'settlements', coalesce((select jsonb_agg(to_jsonb(s) order by s.settled_on) from public.settlements s where v_uid in (s.payer_id, s.payee_id)), '[]'),
    'ledger_entries', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.ledger_entries l where v_uid in (l.debtor_id, l.creditor_id)), '[]'),
    'recurring_templates', coalesce((select jsonb_agg(to_jsonb(t)) from public.recurring_expense_templates t where t.created_by = v_uid), '[]'),
    'budgets', coalesce((select jsonb_agg(to_jsonb(b)) from public.budgets b where b.user_id = v_uid), '[]'),
    'exchange_rates', coalesce((select jsonb_agg(to_jsonb(r)) from public.exchange_rate_snapshots r where r.user_id = v_uid), '[]'),
    'comments', coalesce((select jsonb_agg(to_jsonb(c)) from public.comments c where c.author_id = v_uid), '[]'),
    'receipts', coalesce((select jsonb_agg(to_jsonb(r)) from public.receipt_metadata r where r.owner_id = v_uid), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.notifications n where n.user_id = v_uid), '[]')
  );
end $$;

-- Privileges (see 20261014000005): new functions are not executable until listed.
revoke execute on function public.set_upi_id(text), public.get_upi_id(uuid), public._drop_payment_handles_on_delete()
  from public, anon, authenticated;
grant execute on function public.set_upi_id(text), public.get_upi_id(uuid) to authenticated;
grant execute on function public.set_upi_id(text), public.get_upi_id(uuid), public._drop_payment_handles_on_delete() to service_role;
