-- =============================================================================
-- Phone numbers, and finding people by email or phone number
--
-- * user_contact_info keeps each user's phone number (E.164, one account per
--   number; not verified yet: no OTP) plus SHA-256 hashes of their phone number
--   and email. Only the owner can read their own row. Nobody else is ever
--   given someone's phone number or email.
-- * find_people() takes SHA-256 hashes of emails / phone numbers. The app
--   hashes on the device, so address books are never uploaded or stored. It
--   returns the matching people who allow being found, and how each relates
--   to the caller (friend, request sent, ...). Rate limited.
-- * request_friend() adds someone found that way. You become friends at once
--   when you already share a group or they already asked you. Otherwise they
--   get a friend request to accept, so a stranger who knows a phone number
--   can't put expenses on someone.
-- =============================================================================

create or replace function public._contact_hash(p_value text)
returns text language sql immutable as $$
  select case when p_value is null or p_value = '' then null
              else encode(sha256(convert_to(p_value, 'UTF8')), 'hex') end;
$$;

create table public.user_contact_info (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone_e164 text unique check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_hash text,
  email_hash text,
  updated_at timestamptz not null default now(),
  check ((phone_e164 is null) = (phone_hash is null))
);
create index user_contact_info_phone_hash_idx on public.user_contact_info (phone_hash) where phone_hash is not null;
create index user_contact_info_email_hash_idx on public.user_contact_info (email_hash) where email_hash is not null;
create trigger user_contact_info_updated_at before update on public.user_contact_info for each row execute function public.set_updated_at();

alter table public.user_contact_info enable row level security;
revoke all on public.user_contact_info from public, anon, authenticated;
grant select (user_id, phone_e164, updated_at) on public.user_contact_info to authenticated;
grant all on public.user_contact_info to service_role;
create policy user_contact_info_read_own on public.user_contact_info for select to authenticated
  using (user_id = (select auth.uid()));

-- Existing accounts: email hashes now, phone numbers when they add one.
insert into public.user_contact_info (user_id, email_hash)
select u.id, public._contact_hash(lower(btrim(u.email)))
  from auth.users u join public.profiles p on p.id = u.id
on conflict (user_id) do nothing;

-- "Let people find me by phone number" (email already has discoverable_by_email).
alter table public.user_preferences add column discoverable_by_phone boolean not null default true;
grant update (discoverable_by_phone) on public.user_preferences to authenticated;

-- Saves the caller's phone number in E.164 form (+919876543210). Spaces,
-- dashes, dots and brackets are ignored. An empty value removes it.
create or replace function public.set_my_phone(p_phone text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._uid();
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g'), '');
begin
  perform public._rate_limit(v_uid, 'set_phone', 20, interval '1 hour');
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    perform public._err('INVALID_PHONE', 'Enter the phone number with its country code, for example +91 98765 43210.');
  end if;
  if v_phone is not null and exists (select 1 from public.user_contact_info c where c.phone_e164 = v_phone and c.user_id <> v_uid) then
    perform public._err('PHONE_TAKEN', 'This phone number is already used by another Owenil account.');
  end if;
  begin
    insert into public.user_contact_info (user_id, phone_e164, phone_hash)
    values (v_uid, v_phone, public._contact_hash(v_phone))
    on conflict (user_id) do update set phone_e164 = excluded.phone_e164, phone_hash = excluded.phone_hash;
  exception when unique_violation then
    perform public._err('PHONE_TAKEN', 'This phone number is already used by another Owenil account.');
  end;
  return v_phone;
end $$;

-- People matching any of the given SHA-256 hashes (of a lower-case email, or
-- of an E.164 phone number) who allow being found that way.
-- relation: self | friend | incoming (they asked you) | requested (you asked them) | none
create or replace function public.find_people(p_hashes text[])
returns table (hash text, user_id uuid, display_name text, avatar_url text, avatar_color text, relation text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := public._uid();
begin
  if coalesce(array_length(p_hashes, 1), 0) = 0 then return; end if;
  if array_length(p_hashes, 1) > 2000 then
    perform public._err('TOO_MANY_CONTACTS', 'Check at most 2,000 contacts at a time.');
  end if;
  perform public._rate_limit(v_uid, 'find_people', 30, interval '1 hour');
  return query
    with wanted as (
      select distinct lower(w) as h from unnest(p_hashes) as w where w ~* '^[0-9a-f]{64}$'
    ), matched as (
      select wanted.h, c.user_id as uid
        from wanted
        join public.user_contact_info c on c.phone_hash = wanted.h
        join public.user_preferences up on up.user_id = c.user_id and up.discoverable_by_phone
      union
      select wanted.h, c.user_id
        from wanted
        join public.user_contact_info c on c.email_hash = wanted.h
        join public.user_preferences up on up.user_id = c.user_id and up.discoverable_by_email
    )
    select m.h, p.id, p.display_name, p.avatar_url, p.avatar_color,
           case
             when p.id = v_uid then 'self'
             when public.are_friends(v_uid, p.id) then 'friend'
             when exists (select 1 from public.friendship_invitations i
                           where i.inviter_id = p.id and i.invitee_id = v_uid and i.status = 'pending' and i.expires_at > now()) then 'incoming'
             when exists (select 1 from public.friendship_invitations i
                           where i.inviter_id = v_uid and i.invitee_id = p.id and i.status = 'pending' and i.expires_at > now()) then 'requested'
             else 'none'
           end
      from matched m
      join public.profiles p on p.id = m.uid and p.deleted_at is null;
end $$;

-- Adds a person (found by email or phone) as a friend.
-- Returns 'friends' (done) or 'requested' (they need to accept).
create or replace function public.request_friend(p_user_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._uid();
  v_incoming uuid;
begin
  perform public._rate_limit(v_uid, 'invitation', 60, interval '1 hour');
  if p_user_id is null or p_user_id = v_uid then
    perform public._err('INVALID_PERSON', 'You can’t add yourself as a friend.');
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and deleted_at is null) then
    perform public._err('NOT_FOUND', 'That person isn’t on Owenil.');
  end if;
  if public.are_friends(v_uid, p_user_id) then return 'friends'; end if;

  -- They already asked you: accepting makes you friends.
  select i.id into v_incoming from public.friendship_invitations i
   where i.inviter_id = p_user_id and i.invitee_id = v_uid and i.status = 'pending' and i.expires_at > now()
   order by i.created_at desc limit 1;
  if v_incoming is not null then
    perform public.respond_friend_invitation(v_incoming, true);
    return 'friends';
  end if;

  -- You already share a group: no request needed.
  if exists (select 1 from public.group_members a
               join public.group_members b on b.group_id = a.group_id
              where a.user_id = v_uid and a.status = 'active' and b.user_id = p_user_id and b.status = 'active') then
    perform public._make_friends(v_uid, p_user_id);
    perform public._log_activity(null, v_uid, 'friend_added', 'profile', p_user_id, '{}', array[v_uid, p_user_id]);
    perform public._notify(p_user_id, 'friend_accepted', public._display_name(v_uid) || ' added you as a friend', null, '/friends/' || v_uid);
    return 'friends';
  end if;

  if exists (select 1 from public.friendship_invitations i
              where i.inviter_id = v_uid and i.invitee_id = p_user_id and i.status = 'pending' and i.expires_at > now()) then
    return 'requested';
  end if;
  insert into public.friendship_invitations (inviter_id, invitee_id, token_hash)
  values (v_uid, p_user_id, public._token_hash(public._new_token()));
  perform public._notify(p_user_id, 'friend_invite', public._display_name(v_uid) || ' wants to be friends on Owenil', null, '/friends');
  return 'requested';
end $$;

-- New accounts: as before (20261014000010), plus contact details. A phone
-- number given at sign-up is saved when valid and unused; otherwise
-- onboarding asks for it again.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''));
  v_currency text := upper(coalesce(new.raw_user_meta_data ->> 'default_currency', 'INR'));
  v_tz text := coalesce(new.raw_user_meta_data ->> 'timezone', 'Asia/Kolkata');
  v_phone text := nullif(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[\s().-]', '', 'g'), '');
  v_everyone boolean := exists (select 1 from public.app_settings where key = 'dev_entitlements_mode' and value #>> '{}' = 'everyone');
begin
  if v_name is null then v_name := split_part(coalesce(new.email, 'Owenil user'), '@', 1); end if;
  if not exists (select 1 from public.currencies where code = v_currency) then v_currency := 'INR'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := 'Asia/Kolkata'; end if;

  insert into public.profiles (id, display_name, default_currency, timezone)
  values (new.id, left(v_name, 60), v_currency, v_tz)
  on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  if v_everyone then
    insert into public.subscription_entitlements (user_id, plan, status, source)
    values (new.id, 'plus', 'active', 'development') on conflict do nothing;
    insert into public.subscription_events (user_id, event_type, from_plan, to_plan, source, details)
    values (new.id, 'dev_plan_changed', 'free', 'plus', 'development', jsonb_build_object('mode', 'everyone', 'on_signup', true));
  else
    insert into public.subscription_entitlements (user_id) values (new.id) on conflict do nothing;
  end if;

  if v_phone is not null and (v_phone !~ '^\+[1-9][0-9]{7,14}$' or exists (select 1 from public.user_contact_info where phone_e164 = v_phone)) then
    v_phone := null;
  end if;
  begin
    insert into public.user_contact_info (user_id, phone_e164, phone_hash, email_hash)
    values (new.id, v_phone, public._contact_hash(v_phone), public._contact_hash(lower(btrim(new.email))))
    on conflict (user_id) do nothing;
  exception when unique_violation then
    insert into public.user_contact_info (user_id, email_hash)
    values (new.id, public._contact_hash(lower(btrim(new.email))))
    on conflict (user_id) do nothing;
  end;

  -- Link pending friend invitations addressed to this email.
  if new.email is not null then
    update public.friendship_invitations
       set invitee_id = new.id
     where invitee_email = lower(new.email) and status = 'pending' and invitee_id is null and expires_at > now();
    insert into public.notifications (user_id, kind, title, body, link)
    select new.id, 'friend_invite', public._display_name(i.inviter_id) || ' wants to be friends on Owenil', null, '/friends'
      from public.friendship_invitations i
     where i.invitee_id = new.id and i.status = 'pending';
  end if;
  return new;
end $$;

-- Keeps the email hash current when someone changes their email.
create or replace function public.sync_contact_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.user_contact_info set email_hash = public._contact_hash(lower(btrim(new.email))) where user_id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email) execute function public.sync_contact_email();

-- Deleting an account (profiles.deleted_at set) removes the phone number and hashes.
create or replace function public._drop_contact_info_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.user_contact_info where user_id = new.id;
  return new;
end $$;
create trigger profiles_drop_contact_info after update of deleted_at on public.profiles
  for each row when (new.deleted_at is not null and old.deleted_at is null)
  execute function public._drop_contact_info_on_delete();

-- Data export now includes the phone number.
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'notice', 'Owenil data export. Amounts are integer minor units (e.g. paise) of the stated currency.',
    'profile', (select to_jsonb(p) - 'is_tester' from public.profiles p where p.id = v_uid),
    'email', (select email from auth.users where id = v_uid),
    'phone', (select c.phone_e164 from public.user_contact_info c where c.user_id = v_uid),
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
revoke execute on function public._contact_hash(text), public.set_my_phone(text), public.find_people(text[]),
  public.request_friend(uuid), public.sync_contact_email(), public._drop_contact_info_on_delete()
  from public, anon, authenticated;
grant execute on function public.set_my_phone(text), public.find_people(text[]), public.request_friend(uuid) to authenticated;
grant execute on function public._contact_hash(text), public.set_my_phone(text), public.find_people(text[]),
  public.request_friend(uuid), public.sync_contact_email(), public._drop_contact_info_on_delete() to service_role;
