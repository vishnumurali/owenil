-- =============================================================================
-- Owenil — server-side business logic
-- Every function that changes financial data:
--   * runs in a single transaction (a Postgres function call is atomic),
--   * validates the caller's identity & permissions from auth.uid(),
--   * validates amounts/splits independently of the client,
--   * supports idempotency keys so retries never double-apply,
--   * writes the ledger and an audit snapshot.
-- Errors are raised with errcode P0001; HINT carries a stable error code.
-- =============================================================================

-- ---------- Small internal utilities ----------------------------------------
create or replace function public._err(p_code text, p_message text)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end $$;

create or replace function public._uid()
returns uuid language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then perform public._err('AUTH_REQUIRED', 'Please sign in to continue.'); end if;
  return v;
end $$;

create or replace function public._token_hash(p_token text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

create or replace function public._new_token()
returns text language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function public._rate_limit(p_user uuid, p_bucket text, p_max integer, p_window interval)
returns void language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  select count(*) into v_count from public.rate_limit_events
   where user_id = p_user and bucket = p_bucket and created_at > now() - p_window;
  if v_count >= p_max then
    perform public._err('RATE_LIMITED', 'Too many requests. Please wait a little and try again.');
  end if;
  insert into public.rate_limit_events (user_id, bucket) values (p_user, p_bucket);
end $$;

-- Idempotency: returns the stored response for a replayed key, or NULL when
-- this is a new request (a placeholder row is inserted and locked).
create or replace function public._idem_begin(p_user uuid, p_key text, p_operation text, p_request jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_hash text := md5(coalesce(p_request::text, ''));
  v_row public.idempotency_records;
begin
  if p_key is null then return null; end if;
  if char_length(p_key) < 8 or char_length(p_key) > 100 then
    perform public._err('INVALID_IDEMPOTENCY_KEY', 'Invalid request key.');
  end if;
  insert into public.idempotency_records (user_id, key, operation, request_hash)
  values (p_user, p_key, p_operation, v_hash)
  on conflict (user_id, key) do nothing;
  if found then return null; end if;
  select * into v_row from public.idempotency_records where user_id = p_user and key = p_key;
  if v_row.operation <> p_operation or v_row.request_hash <> v_hash then
    perform public._err('IDEMPOTENCY_KEY_REUSED', 'This request key was already used for a different request.');
  end if;
  return coalesce(v_row.response, '{}'::jsonb) || jsonb_build_object('replayed', true);
end $$;

create or replace function public._idem_finish(p_user uuid, p_key text, p_response jsonb)
returns void language sql security definer set search_path = public as $$
  update public.idempotency_records set response = p_response where user_id = p_user and key = p_key;
$$;

create or replace function public._notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_pref public.user_preferences;
begin
  if p_user is null then return; end if;
  select * into v_pref from public.user_preferences where user_id = p_user;
  if v_pref.user_id is not null then
    if (p_kind like 'expense%' and not v_pref.notify_expenses)
       or (p_kind like 'settlement%' and not v_pref.notify_settlements)
       or (p_kind like 'comment%' and not v_pref.notify_comments)
       or (p_kind like 'budget%' and not v_pref.notify_budget_alerts)
       or (p_kind like 'recurring%' and not v_pref.notify_recurring) then
      return;
    end if;
  end if;
  insert into public.notifications (user_id, kind, title, body, link, data)
  values (p_user, p_kind, left(p_title, 200), left(p_body, 1000), p_link, coalesce(p_data, '{}'));
end $$;

create or replace function public._log_activity(p_group uuid, p_actor uuid, p_type text, p_entity_type text, p_entity_id uuid, p_summary jsonb, p_visible_to uuid[] default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.activity_events (group_id, actor_id, event_type, entity_type, entity_id, summary, visible_to)
  values (p_group, p_actor, p_type, p_entity_type, p_entity_id, coalesce(p_summary, '{}'), coalesce(p_visible_to, '{}'));
$$;

create or replace function public._display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.profiles where id = p_user), 'Someone');
$$;

create or replace function public._fmt_amount(p_amount bigint, p_currency char(3))
returns text language sql stable security definer set search_path = public as $$
  select p_currency || ' ' || to_char(p_amount::numeric / power(10, c.minor_units), 'FM999,999,999,990' || case when c.minor_units > 0 then '.' || repeat('0', c.minor_units) else '' end)
  from public.currencies c where c.code = p_currency;
$$;

-- Validate profile time zones against the server's tz database.
create or replace function public._validate_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    perform public._err('INVALID_TIMEZONE', 'Unknown time zone.');
  end if;
  return new;
end $$;
create trigger profiles_validate before insert or update of timezone on public.profiles
  for each row execute function public._validate_profile();

-- ---------- Account bootstrap -------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  v_currency text := upper(coalesce(new.raw_user_meta_data ->> 'default_currency', 'INR'));
  v_tz text := coalesce(new.raw_user_meta_data ->> 'timezone', 'Asia/Kolkata');
begin
  if v_name is null then v_name := split_part(coalesce(new.email, 'Owenil user'), '@', 1); end if;
  if not exists (select 1 from public.currencies where code = v_currency) then v_currency := 'INR'; end if;
  if not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := 'Asia/Kolkata'; end if;

  insert into public.profiles (id, display_name, default_currency, timezone)
  values (new.id, left(v_name, 60), v_currency, v_tz)
  on conflict (id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict do nothing;
  insert into public.subscription_entitlements (user_id) values (new.id) on conflict do nothing;

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- If an auth user is removed by any route, anonymise the profile.
create or replace function public.handle_deleted_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles
     set display_name = 'Deleted user', avatar_url = null, deleted_at = coalesce(deleted_at, now())
   where id = old.id;
  return old;
end $$;
drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted after delete on auth.users
  for each row execute function public.handle_deleted_user();

-- ---------- Balances ---------------------------------------------------------
-- Net position of every member of a group (positive = is owed), per currency.
create or replace function public._group_nets(p_group_id uuid)
returns table (user_id uuid, currency char(3), net_minor bigint)
language sql stable security definer set search_path = public as $$
  select x.u, x.cur, sum(x.delta)::bigint
    from (select le.creditor_id as u, le.currency as cur, le.amount_minor as delta from public.ledger_entries le where le.group_id = p_group_id
          union all
          select le.debtor_id, le.currency, -le.amount_minor from public.ledger_entries le where le.group_id = p_group_id) x
   group by x.u, x.cur
  having sum(x.delta) <> 0;
$$;

create or replace function public.get_group_balances(p_group_id uuid)
returns table (user_id uuid, currency char(3), net_minor bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_group_member(p_group_id, public._uid()) then
    perform public._err('FORBIDDEN', 'You are not a member of this group.');
  end if;
  return query select * from public._group_nets(p_group_id);
end $$;

-- Everything the client needs to show balances: net positions of all members
-- of the caller's groups, and the caller's own pairwise balances (group and
-- non-group). Positive pair net = the counterparty owes the caller.
create or replace function public.get_balance_overview()
returns table (kind text, group_id uuid, user_id uuid, currency char(3), net_minor bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := public._uid();
begin
  return query
  select 'group_net'::text, gm.group_id, n.user_id, n.currency, n.net_minor
    from public.group_members gm
    join public.groups g on g.id = gm.group_id and g.deleted_at is null
    cross join lateral public._group_nets(gm.group_id) n
   where gm.user_id = v_uid and gm.status = 'active'
  union all
  select 'pair'::text, x.gid, x.other, x.cur, sum(x.delta)::bigint
    from (select le.group_id as gid, le.debtor_id as other, le.currency as cur, le.amount_minor as delta
            from public.ledger_entries le where le.creditor_id = v_uid
          union all
          select le.group_id, le.creditor_id, le.currency, -le.amount_minor
            from public.ledger_entries le where le.debtor_id = v_uid) x
   group by x.gid, x.other, x.cur
  having sum(x.delta) <> 0;
end $$;

create or replace function public._user_has_open_group_balance(p_group_id uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public._group_nets(p_group_id) n where n.user_id = p_user);
$$;

create or replace function public._user_has_any_open_balance(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from (
      select le.group_id, le.currency, case when le.creditor_id = p_user then le.debtor_id else le.creditor_id end as other,
             case when le.creditor_id = p_user then le.amount_minor else -le.amount_minor end as delta
        from public.ledger_entries le where p_user in (le.creditor_id, le.debtor_id)
    ) x group by x.group_id, x.currency, x.other having sum(x.delta) <> 0
  );
$$;

-- ---------- Ledger writers ---------------------------------------------------
-- Pairwise attribution of an expense. Mirrors attributeExpense() in
-- packages/core/src/ledger.ts: everyone first covers their own share, then
-- remaining debts are matched to remaining credits in user-id order.
create or replace function public._expense_ledger_lines(p_expense_id uuid)
returns table (debtor uuid, creditor uuid, amount bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  d_ids uuid[]; d_left bigint[]; c_ids uuid[]; c_left bigint[];
  i integer := 1; j integer := 1; v_amt bigint;
begin
  with paid as (
         select ep.user_id as uid, sum(ep.amount_minor) as a from public.expense_payers ep where ep.expense_id = p_expense_id group by ep.user_id),
       owed as (
         select es.user_id as uid, sum(es.amount_minor) as a from public.expense_splits es where es.expense_id = p_expense_id group by es.user_id),
       people as (
         select coalesce(p.uid, o.uid) as uid, coalesce(p.a, 0) as c, coalesce(o.a, 0) as s
           from paid p full join owed o on o.uid = p.uid)
  select array_agg(pp.uid order by pp.uid) filter (where pp.s - least(pp.c, pp.s) > 0),
         array_agg(pp.s - least(pp.c, pp.s) order by pp.uid) filter (where pp.s - least(pp.c, pp.s) > 0),
         array_agg(pp.uid order by pp.uid) filter (where pp.c - least(pp.c, pp.s) > 0),
         array_agg(pp.c - least(pp.c, pp.s) order by pp.uid) filter (where pp.c - least(pp.c, pp.s) > 0)
    into d_ids, d_left, c_ids, c_left
    from people pp;
  if d_ids is null or c_ids is null then return; end if;
  while i <= array_length(d_ids, 1) and j <= array_length(c_ids, 1) loop
    v_amt := least(d_left[i], c_left[j]);
    if v_amt > 0 then
      debtor := d_ids[i]; creditor := c_ids[j]; amount := v_amt;
      return next;
    end if;
    d_left[i] := d_left[i] - v_amt;
    c_left[j] := c_left[j] - v_amt;
    if d_left[i] = 0 then i := i + 1; end if;
    if c_left[j] = 0 then j := j + 1; end if;
  end loop;
end $$;

create or replace function public._apply_expense_ledger(p_expense_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_e public.expenses;
begin
  select * into v_e from public.expenses where id = p_expense_id;
  insert into public.ledger_entries (group_id, currency, debtor_id, creditor_id, amount_minor, source_type, source_id, source_version, created_by)
  select v_e.group_id, v_e.currency, l.debtor, l.creditor, l.amount, 'expense', v_e.id, v_e.version, p_actor
    from public._expense_ledger_lines(p_expense_id) l;
end $$;

-- Reverse every not-yet-reversed line of a source (exactly once, enforced by a unique index).
create or replace function public._reverse_source_ledger(p_type public.ledger_source, p_source_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.ledger_entries (group_id, currency, debtor_id, creditor_id, amount_minor, source_type, source_id, source_version, reverses_entry_id, created_by)
  select le.group_id, le.currency, le.debtor_id, le.creditor_id, -le.amount_minor, le.source_type, le.source_id, le.source_version, le.id, p_actor
    from public.ledger_entries le
   where le.source_type = p_type and le.source_id = p_source_id and le.reverses_entry_id is null
     and not exists (select 1 from public.ledger_entries r where r.reverses_entry_id = le.id);
end $$;

-- ---------- Expense validation & persistence ---------------------------------
create or replace function public._jint(p jsonb, p_key text, p_label text)
returns bigint language plpgsql immutable as $$
declare v text := p ->> p_key;
begin
  if v is null or v !~ '^-?\d{1,15}$' then
    perform public._err('INVALID_AMOUNT', p_label || ' must be a whole number of minor units.');
  end if;
  return v::bigint;
end $$;

-- Validates a payload and returns the normalised list of involved users.
-- p_existing_users: users already on the expense being edited (may stay even if not friends).
create or replace function public._validate_expense_payload(p jsonb, p_group_id uuid, p_actor uuid, p_existing_users uuid[] default '{}')
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare
  v_amount bigint := public._jint(p, 'amount_minor', 'Amount');
  v_currency text := p ->> 'currency';
  v_method text := p ->> 'split_method';
  v_desc text := trim(coalesce(p ->> 'description', ''));
  v_date date;
  v_cnt integer; v_distinct integer; v_sum numeric; v_min numeric; v_max numeric;
  v_users uuid[];
  v_u uuid;
  v_w numeric;
begin
  if char_length(v_desc) < 1 or char_length(v_desc) > 140 then perform public._err('INVALID_DESCRIPTION', 'Add a description (up to 140 characters).'); end if;
  if v_amount <= 0 or v_amount > 1000000000000 then perform public._err('INVALID_AMOUNT', 'Amount must be greater than zero.'); end if;
  if not exists (select 1 from public.currencies where code = v_currency) then perform public._err('INVALID_CURRENCY', 'Unsupported currency.'); end if;
  if v_method is null or v_method not in ('equal', 'exact', 'percentage', 'shares', 'adjustment', 'itemized') then
    perform public._err('INVALID_SPLIT_METHOD', 'Unknown split method.');
  end if;
  begin
    v_date := (p ->> 'expense_date')::date;
  exception when others then
    perform public._err('INVALID_DATE', 'Use a valid date.');
  end;
  if v_date is null or v_date < date '2000-01-01' or v_date > current_date + 366 then perform public._err('INVALID_DATE', 'Use a date between 2000 and next year.'); end if;
  if p ? 'notes' and p ->> 'notes' is not null and char_length(p ->> 'notes') > 2000 then perform public._err('INVALID_NOTES', 'Notes are limited to 2000 characters.'); end if;
  if jsonb_typeof(coalesce(p -> 'tags', '[]')) <> 'array' or jsonb_array_length(coalesce(p -> 'tags', '[]')) > 10 then perform public._err('INVALID_TAGS', 'Use up to 10 tags.'); end if;
  if (p ->> 'category_id') is not null and not exists (
       select 1 from public.categories c where c.id = (p ->> 'category_id')::uuid
          and (c.is_system or c.owner_id = p_actor or c.owner_id = any (p_existing_users)
               or (p_group_id is not null and public.is_group_member(p_group_id, c.owner_id)))) then
    perform public._err('INVALID_CATEGORY', 'Unknown category.');
  end if;

  -- Payers: positive, unique, Σ = amount
  if coalesce(jsonb_typeof(p -> 'payers'), 'null') <> 'array' or jsonb_array_length(p -> 'payers') = 0 or jsonb_array_length(p -> 'payers') > 50 then
    perform public._err('INVALID_PAYERS', 'Choose who paid.');
  end if;
  select count(*), count(distinct x.user_id), sum(x.amount_minor), min(x.amount_minor)
    into v_cnt, v_distinct, v_sum, v_min from jsonb_to_recordset(p -> 'payers') as x(user_id uuid, amount_minor bigint);
  if v_cnt <> v_distinct then perform public._err('INVALID_PAYERS', 'A payer was listed twice.'); end if;
  if v_min is null or v_min <= 0 then perform public._err('INVALID_PAYERS', 'Each payer must pay more than zero.'); end if;
  if v_sum <> v_amount then perform public._err('PAYER_MISMATCH', 'Payer amounts must add up to the total.'); end if;

  -- Participants (inputs) and splits (outputs)
  if coalesce(jsonb_typeof(p -> 'participants'), 'null') <> 'array' or jsonb_array_length(p -> 'participants') = 0 or jsonb_array_length(p -> 'participants') > 50 then
    perform public._err('INVALID_PARTICIPANTS', 'Choose at least one person to split with.');
  end if;
  select count(*), count(distinct x.user_id) into v_cnt, v_distinct
    from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint);
  if v_cnt <> v_distinct then perform public._err('INVALID_PARTICIPANTS', 'A participant was listed twice.'); end if;

  if coalesce(jsonb_typeof(p -> 'splits'), 'null') <> 'array' then perform public._err('INVALID_SPLITS', 'Missing split allocation.'); end if;
  select count(*), count(distinct x.user_id), sum(x.amount_minor), min(x.amount_minor), max(x.amount_minor)
    into v_cnt, v_distinct, v_sum, v_min, v_max from jsonb_to_recordset(p -> 'splits') as x(user_id uuid, amount_minor bigint);
  if v_cnt = 0 or v_cnt <> v_distinct then perform public._err('INVALID_SPLITS', 'Each person may appear once in the split.'); end if;
  if v_min < 0 then perform public._err('INVALID_SPLITS', 'Shares cannot be negative.'); end if;
  if v_sum <> v_amount then perform public._err('SPLIT_MISMATCH', 'Shares must add up to the total.'); end if;
  if v_max <= 0 then perform public._err('INVALID_SPLITS', 'At least one person must owe a share.'); end if;

  -- The split users must be exactly the included participants
  if exists (
      (select x.user_id from jsonb_to_recordset(p -> 'splits') as x(user_id uuid, amount_minor bigint)
       except
       select x.user_id from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint) where coalesce(x.included, true))
      union all
      (select x.user_id from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint) where coalesce(x.included, true)
       except
       select x.user_id from jsonb_to_recordset(p -> 'splits') as x(user_id uuid, amount_minor bigint))) then
    perform public._err('INVALID_SPLITS', 'The split does not match the selected participants.');
  end if;

  -- Method-specific consistency between inputs and allocations
  if v_method in ('equal', 'percentage', 'shares') then
    select sum(case when v_method = 'equal' then 1 else coalesce(x.value, 0) end) into v_w
      from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint) where coalesce(x.included, true);
    if v_method = 'percentage' and v_w <> 10000 then perform public._err('PERCENT_MISMATCH', 'Percentages must add up to 100%.'); end if;
    if v_w is null or v_w <= 0 then perform public._err('INVALID_SPLITS', 'Shares must be greater than zero.'); end if;
    if exists (
        select 1 from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint)
          join jsonb_to_recordset(p -> 'splits') as s(user_id uuid, amount_minor bigint) on s.user_id = x.user_id
         where coalesce(x.included, true)
           and (coalesce(x.value, 0) < 0
                or abs(s.amount_minor::numeric * v_w - v_amount::numeric * (case when v_method = 'equal' then 1 else coalesce(x.value, 0) end)) >= v_w)) then
      perform public._err('SPLIT_INCONSISTENT', 'The allocation does not match the chosen split method.');
    end if;
  elsif v_method = 'exact' then
    if exists (
        select 1 from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint)
          join jsonb_to_recordset(p -> 'splits') as s(user_id uuid, amount_minor bigint) on s.user_id = x.user_id
         where coalesce(x.included, true) and s.amount_minor is distinct from x.value) then
      perform public._err('SPLIT_INCONSISTENT', 'Exact amounts do not match the allocation.');
    end if;
  elsif v_method = 'adjustment' then
    select max(s.amount_minor - coalesce(x.value, 0)) - min(s.amount_minor - coalesce(x.value, 0)) into v_w
      from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint)
      join jsonb_to_recordset(p -> 'splits') as s(user_id uuid, amount_minor bigint) on s.user_id = x.user_id
     where coalesce(x.included, true);
    if v_w > 1 then perform public._err('SPLIT_INCONSISTENT', 'The allocation does not match the adjustments.'); end if;
  elsif v_method = 'itemized' then
    if coalesce(jsonb_typeof(p -> 'items'), 'null') <> 'array' or jsonb_array_length(p -> 'items') = 0 or jsonb_array_length(p -> 'items') > 200 then
      perform public._err('INVALID_ITEMS', 'Add the receipt items.');
    end if;
    select sum(case when x.kind = 'discount' then -x.amount_minor else x.amount_minor end), min(x.amount_minor)
      into v_sum, v_min from jsonb_to_recordset(p -> 'items') as x(name text, amount_minor bigint, kind text, assignees jsonb);
    if v_min < 0 then perform public._err('INVALID_ITEMS', 'Item amounts cannot be negative.'); end if;
    if v_sum is distinct from v_amount then perform public._err('ITEMS_MISMATCH', 'Receipt lines must add up to the total.'); end if;
    if exists (select 1 from jsonb_to_recordset(p -> 'items') as x(name text, amount_minor bigint, kind text, assignees jsonb)
                where coalesce(x.kind, 'item') not in ('item', 'tax', 'tip', 'discount')
                   or char_length(coalesce(trim(x.name), '')) not between 1 and 120
                   or (coalesce(x.kind, 'item') = 'item' and (x.assignees is null or jsonb_array_length(x.assignees) = 0))) then
      perform public._err('INVALID_ITEMS', 'Every item needs a name and at least one person.');
    end if;
    if exists (select 1 from jsonb_to_recordset(p -> 'items') as x(name text, amount_minor bigint, kind text, assignees jsonb)
                cross join lateral jsonb_to_recordset(coalesce(x.assignees, '[]')) as a(user_id uuid, weight integer)
                where a.weight is null or a.weight <= 0
                   or a.user_id not in (select y.user_id from jsonb_to_recordset(p -> 'participants') as y(user_id uuid, included boolean, value bigint) where coalesce(y.included, true))) then
      perform public._err('INVALID_ITEMS', 'Items can only be assigned to participants.');
    end if;
  end if;

  -- Involved people and relationship checks
  select array_agg(distinct u) into v_users from (
    select x.user_id as u from jsonb_to_recordset(p -> 'payers') as x(user_id uuid, amount_minor bigint)
    union select x.user_id from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint)
  ) z;

  if p_group_id is not null then
    foreach v_u in array v_users loop
      if not public.is_group_member(p_group_id, v_u) then
        perform public._err('NOT_GROUP_MEMBER', 'Everyone on the expense must be a current member of the group.');
      end if;
    end loop;
  else
    if not (p_actor = any (v_users)) then
      perform public._err('NOT_INVOLVED', 'You must take part in a non-group expense.');
    end if;
    foreach v_u in array v_users loop
      if v_u <> p_actor and not public.are_friends(p_actor, v_u) and not (v_u = any (p_existing_users)) then
        perform public._err('NOT_FRIENDS', 'You can only share non-group expenses with friends.');
      end if;
    end loop;
  end if;
  return v_users;
end $$;

create or replace function public._write_expense_children(p_expense_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_item_id uuid; v_pos integer := 0;
begin
  delete from public.expense_items where expense_id = p_expense_id;
  delete from public.expense_payers where expense_id = p_expense_id;
  delete from public.expense_participants where expense_id = p_expense_id;
  delete from public.expense_splits where expense_id = p_expense_id;

  insert into public.expense_payers (expense_id, user_id, amount_minor)
  select p_expense_id, x.user_id, x.amount_minor from jsonb_to_recordset(p -> 'payers') as x(user_id uuid, amount_minor bigint);
  insert into public.expense_participants (expense_id, user_id, included, input_value)
  select p_expense_id, x.user_id, coalesce(x.included, true), x.value from jsonb_to_recordset(p -> 'participants') as x(user_id uuid, included boolean, value bigint);
  insert into public.expense_splits (expense_id, user_id, amount_minor)
  select p_expense_id, x.user_id, x.amount_minor from jsonb_to_recordset(p -> 'splits') as x(user_id uuid, amount_minor bigint);

  if (p ->> 'split_method') = 'itemized' then
    for v_item in select * from jsonb_array_elements(p -> 'items') loop
      insert into public.expense_items (expense_id, name, amount_minor, kind, position)
      values (p_expense_id, trim(v_item ->> 'name'), (v_item ->> 'amount_minor')::bigint, coalesce(v_item ->> 'kind', 'item')::public.item_kind, v_pos)
      returning id into v_item_id;
      insert into public.expense_item_assignments (item_id, user_id, weight)
      select v_item_id, a.user_id, coalesce(a.weight, 1) from jsonb_to_recordset(coalesce(v_item -> 'assignees', '[]')) as a(user_id uuid, weight integer);
      v_pos := v_pos + 1;
    end loop;
  end if;
end $$;

create or replace function public._expense_snapshot(p_expense_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'expense', to_jsonb(e) - 'created_at' - 'updated_at',
    'payers', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'amount_minor', x.amount_minor) order by x.user_id) from public.expense_payers x where x.expense_id = e.id), '[]'),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'included', x.included, 'value', x.input_value) order by x.user_id) from public.expense_participants x where x.expense_id = e.id), '[]'),
    'splits', coalesce((select jsonb_agg(jsonb_build_object('user_id', x.user_id, 'amount_minor', x.amount_minor) order by x.user_id) from public.expense_splits x where x.expense_id = e.id), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'amount_minor', i.amount_minor, 'kind', i.kind,
                          'assignees', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'weight', a.weight)) from public.expense_item_assignments a where a.item_id = i.id), '[]'))
                          order by i.position) from public.expense_items i where i.expense_id = e.id), '[]'))
  from public.expenses e where e.id = p_expense_id;
$$;

-- Budget threshold alerts for everyone who owes a share of this expense.
create or replace function public._check_budget_alerts(p_expense_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e public.expenses; r record; v_start date; v_end date; v_spent bigint; v_share bigint; v_before bigint;
begin
  select * into v_e from public.expenses where id = p_expense_id;
  for r in
    select b.*, s.amount_minor as share
      from public.expense_splits s
      join public.budgets b on b.user_id = s.user_id and b.currency = v_e.currency
                           and (b.category_id is null or b.category_id = v_e.category_id)
                           and (b.group_id is null or b.group_id is not distinct from v_e.group_id)
     where s.expense_id = p_expense_id and s.amount_minor > 0 and public.is_premium(s.user_id)
  loop
    if r.period = 'monthly' then
      v_start := date_trunc('month', v_e.expense_date)::date; v_end := (v_start + interval '1 month - 1 day')::date;
    else
      v_start := date_trunc('year', v_e.expense_date)::date; v_end := (v_start + interval '1 year - 1 day')::date;
    end if;
    select coalesce(sum(s.amount_minor), 0) into v_spent
      from public.expense_splits s join public.expenses e on e.id = s.expense_id
     where s.user_id = r.user_id and e.deleted_at is null and e.currency = r.currency
       and e.expense_date between v_start and v_end
       and (r.category_id is null or e.category_id = r.category_id)
       and (r.group_id is null or e.group_id = r.group_id);
    v_share := r.share;
    v_before := v_spent - v_share;
    if v_before <= r.amount_minor and v_spent > r.amount_minor then
      perform public._notify(r.user_id, 'budget_over', 'Budget exceeded: ' || r.name,
        'You have spent ' || public._fmt_amount(v_spent, r.currency) || ' of ' || public._fmt_amount(r.amount_minor, r.currency) || '.', '/budgets');
    elsif v_before * 100 < r.amount_minor * r.alert_threshold_pct and v_spent * 100 >= r.amount_minor * r.alert_threshold_pct then
      perform public._notify(r.user_id, 'budget_warning', 'Budget alert: ' || r.name,
        'You have used ' || r.alert_threshold_pct || '% or more of this budget.', '/budgets');
    end if;
  end loop;
end $$;

-- Core expense creation used by the RPC, the recurring generator and seeding.
create or replace function public._create_expense_core(p jsonb, p_actor uuid, p_template_id uuid default null, p_is_demo boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_users uuid[];
  v_id uuid;
  v_g public.groups;
  v_u uuid;
  v_receipt uuid := nullif(p ->> 'receipt_id', '')::uuid;
begin
  if v_group is not null then
    select * into v_g from public.groups where id = v_group and deleted_at is null;
    if v_g.id is null or not public.is_group_member(v_group, p_actor) then perform public._err('FORBIDDEN', 'You are not a member of this group.'); end if;
    if v_g.archived_at is not null then perform public._err('GROUP_ARCHIVED', 'This group is archived. Unarchive it to add expenses.'); end if;
  end if;
  if (p ->> 'split_method') = 'itemized' and not public.is_premium(p_actor) and p_template_id is null then
    perform public._err('PREMIUM_REQUIRED', 'Itemized receipt splitting is an Owenil Plus feature.');
  end if;
  if v_receipt is not null and not exists (select 1 from public.receipt_metadata r where r.id = v_receipt and r.owner_id = p_actor and r.expense_id is null) then
    perform public._err('INVALID_RECEIPT', 'Receipt not found.');
  end if;

  v_users := public._validate_expense_payload(p, v_group, p_actor);

  insert into public.expenses (group_id, description, amount_minor, currency, expense_date, category_id, notes, tags, split_method,
                               receipt_id, recurring_template_id, created_by, is_demo)
  values (v_group, trim(p ->> 'description'), (p ->> 'amount_minor')::bigint, p ->> 'currency', (p ->> 'expense_date')::date,
          nullif(p ->> 'category_id', '')::uuid, nullif(trim(coalesce(p ->> 'notes', '')), ''),
          coalesce(array(select left(trim(t), 30) from jsonb_array_elements_text(coalesce(p -> 'tags', '[]')) t where trim(t) <> ''), '{}'),
          (p ->> 'split_method')::public.split_method, v_receipt, p_template_id, p_actor, p_is_demo)
  returning id into v_id;

  if v_receipt is not null then update public.receipt_metadata set expense_id = v_id where id = v_receipt; end if;

  perform public._write_expense_children(v_id, p);
  perform public._apply_expense_ledger(v_id, p_actor);
  insert into public.expense_revisions (expense_id, version, change_type, snapshot, changed_by)
  values (v_id, 1, 'created', public._expense_snapshot(v_id), p_actor);

  perform public._log_activity(v_group, p_actor, 'expense_created', 'expense', v_id,
    jsonb_build_object('description', trim(p ->> 'description'), 'amount_minor', (p ->> 'amount_minor')::bigint, 'currency', p ->> 'currency'),
    case when v_group is null then v_users else '{}' end);

  foreach v_u in array v_users loop
    if v_u <> p_actor then
      perform public._notify(v_u, case when p_template_id is null then 'expense_added' else 'recurring_expense_added' end,
        public._display_name(p_actor) || ' added “' || trim(p ->> 'description') || '”',
        public._fmt_amount((p ->> 'amount_minor')::bigint, p ->> 'currency') || coalesce(' in ' || v_g.name, ''),
        '/expenses/' || v_id, jsonb_build_object('expense_id', v_id));
    end if;
  end loop;
  perform public._check_budget_alerts(v_id);
  return v_id;
end $$;

create or replace function public.create_expense(p_payload jsonb, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._uid();
  v_replay jsonb;
  v_id uuid;
  v_result jsonb;
begin
  v_replay := public._idem_begin(v_uid, p_idempotency_key, 'create_expense', p_payload);
  if v_replay is not null then return v_replay; end if;
  perform public._rate_limit(v_uid, 'expense_write', 600, interval '1 hour');
  v_id := public._create_expense_core(p_payload, v_uid);
  v_result := jsonb_build_object('expense_id', v_id, 'version', 1);
  perform public._idem_finish(v_uid, p_idempotency_key, v_result);
  return v_result;
end $$;

create or replace function public._can_modify_expense(p_e public.expenses, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_e.group_id is not null then
      public.is_group_member(p_e.group_id, p_user)
      and (p_e.created_by = p_user or public.is_expense_party(p_e.id, p_user) or public.is_group_admin(p_e.group_id, p_user))
    else p_e.created_by = p_user or public.is_expense_party(p_e.id, p_user)
  end;
$$;

-- Edit = reverse the old ledger lines + apply the new ones, exactly once,
-- guarded by optimistic concurrency on `version`.
create or replace function public.update_expense(p_expense_id uuid, p_expected_version integer, p_payload jsonb, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._uid();
  v_e public.expenses;
  v_replay jsonb;
  v_existing uuid[];
  v_users uuid[];
  v_u uuid;
  v_result jsonb;
  v_receipt uuid := nullif(p_payload ->> 'receipt_id', '')::uuid;
begin
  v_replay := public._idem_begin(v_uid, p_idempotency_key, 'update_expense:' || p_expense_id, p_payload);
  if v_replay is not null then return v_replay; end if;
  perform public._rate_limit(v_uid, 'expense_write', 600, interval '1 hour');

  select * into v_e from public.expenses where id = p_expense_id for update;
  if v_e.id is null or not public.can_view_expense(v_e.id, v_uid) then perform public._err('NOT_FOUND', 'Expense not found.'); end if;
  if v_e.deleted_at is not null then perform public._err('EXPENSE_DELETED', 'Restore this expense before editing it.'); end if;
  if not public._can_modify_expense(v_e, v_uid) then perform public._err('FORBIDDEN', 'You don’t have permission to edit this expense.'); end if;
  if v_e.version <> p_expected_version then
    perform public._err('VERSION_CONFLICT', 'Someone else changed this expense. Reload to see the latest version.');
  end if;
  if (p_payload ->> 'group_id') is distinct from (v_e.group_id::text) then
    perform public._err('GROUP_CHANGE_NOT_ALLOWED', 'An expense cannot be moved to a different group.');
  end if;
  if v_e.group_id is not null and exists (select 1 from public.groups g where g.id = v_e.group_id and g.archived_at is not null) then
    perform public._err('GROUP_ARCHIVED', 'This group is archived. Unarchive it to edit expenses.');
  end if;
  if (p_payload ->> 'split_method') = 'itemized' and v_e.split_method <> 'itemized' and not public.is_premium(v_uid) then
    perform public._err('PREMIUM_REQUIRED', 'Itemized receipt splitting is an Owenil Plus feature.');
  end if;
  if v_receipt is not null and v_receipt is distinct from v_e.receipt_id
     and not exists (select 1 from public.receipt_metadata r where r.id = v_receipt and r.owner_id = v_uid and r.expense_id is null) then
    perform public._err('INVALID_RECEIPT', 'Receipt not found.');
  end if;

  select array_agg(distinct u) into v_existing from (
    select user_id as u from public.expense_payers where expense_id = v_e.id
    union select user_id from public.expense_participants where expense_id = v_e.id) z;
  v_users := public._validate_expense_payload(p_payload, v_e.group_id, v_uid, coalesce(v_existing, '{}'));

  perform public._reverse_source_ledger('expense', v_e.id, v_uid);

  update public.expenses set
    description = trim(p_payload ->> 'description'),
    amount_minor = (p_payload ->> 'amount_minor')::bigint,
    currency = p_payload ->> 'currency',
    expense_date = (p_payload ->> 'expense_date')::date,
    category_id = nullif(p_payload ->> 'category_id', '')::uuid,
    notes = nullif(trim(coalesce(p_payload ->> 'notes', '')), ''),
    tags = coalesce(array(select left(trim(t), 30) from jsonb_array_elements_text(coalesce(p_payload -> 'tags', '[]')) t where trim(t) <> ''), '{}'),
    split_method = (p_payload ->> 'split_method')::public.split_method,
    receipt_id = v_receipt,
    version = version + 1
  where id = v_e.id;

  if v_receipt is distinct from v_e.receipt_id then
    update public.receipt_metadata set expense_id = null where id = v_e.receipt_id;
    if v_receipt is not null then update public.receipt_metadata set expense_id = v_e.id where id = v_receipt; end if;
  end if;

  perform public._write_expense_children(v_e.id, p_payload);
  perform public._apply_expense_ledger(v_e.id, v_uid);
  insert into public.expense_revisions (expense_id, version, change_type, snapshot, changed_by)
  values (v_e.id, v_e.version + 1, 'updated', public._expense_snapshot(v_e.id), v_uid);

  perform public._log_activity(v_e.group_id, v_uid, 'expense_updated', 'expense', v_e.id,
    jsonb_build_object('description', trim(p_payload ->> 'description'), 'amount_minor', (p_payload ->> 'amount_minor')::bigint,
                       'currency', p_payload ->> 'currency', 'previous_amount_minor', v_e.amount_minor),
    case when v_e.group_id is null then (select array_agg(distinct x) from unnest(v_users || coalesce(v_existing, '{}')) x) else '{}' end);

  foreach v_u in array (select array_agg(distinct x) from unnest(v_users || coalesce(v_existing, '{}')) x) loop
    if v_u <> v_uid then
      perform public._notify(v_u, 'expense_updated', public._display_name(v_uid) || ' edited “' || trim(p_payload ->> 'description') || '”',
        public._fmt_amount((p_payload ->> 'amount_minor')::bigint, p_payload ->> 'currency'), '/expenses/' || v_e.id, jsonb_build_object('expense_id', v_e.id));
    end if;
  end loop;
  perform public._check_budget_alerts(v_e.id);

  v_result := jsonb_build_object('expense_id', v_e.id, 'version', v_e.version + 1);
  perform public._idem_finish(v_uid, p_idempotency_key, v_result);
  return v_result;
end $$;

create or replace function public.delete_expense(p_expense_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_e public.expenses; v_users uuid[]; v_u uuid;
begin
  select * into v_e from public.expenses where id = p_expense_id for update;
  if v_e.id is null or not public.can_view_expense(v_e.id, v_uid) then perform public._err('NOT_FOUND', 'Expense not found.'); end if;
  if v_e.deleted_at is not null then return jsonb_build_object('expense_id', v_e.id, 'version', v_e.version, 'already_deleted', true); end if;
  if not public._can_modify_expense(v_e, v_uid) then perform public._err('FORBIDDEN', 'You don’t have permission to delete this expense.'); end if;
  if v_e.version <> p_expected_version then perform public._err('VERSION_CONFLICT', 'Someone else changed this expense. Reload and try again.'); end if;

  perform public._reverse_source_ledger('expense', v_e.id, v_uid);
  update public.expenses set deleted_at = now(), deleted_by = v_uid, version = version + 1 where id = v_e.id;
  insert into public.expense_revisions (expense_id, version, change_type, snapshot, changed_by)
  values (v_e.id, v_e.version + 1, 'deleted', public._expense_snapshot(v_e.id), v_uid);

  select array_agg(distinct u) into v_users from (
    select user_id as u from public.expense_payers where expense_id = v_e.id union select user_id from public.expense_participants where expense_id = v_e.id) z;
  perform public._log_activity(v_e.group_id, v_uid, 'expense_deleted', 'expense', v_e.id,
    jsonb_build_object('description', v_e.description, 'amount_minor', v_e.amount_minor, 'currency', v_e.currency),
    case when v_e.group_id is null then v_users else '{}' end);
  foreach v_u in array v_users loop
    if v_u <> v_uid then
      perform public._notify(v_u, 'expense_deleted', public._display_name(v_uid) || ' deleted “' || v_e.description || '”',
        public._fmt_amount(v_e.amount_minor, v_e.currency), '/expenses/' || v_e.id);
    end if;
  end loop;
  return jsonb_build_object('expense_id', v_e.id, 'version', v_e.version + 1);
end $$;

create or replace function public.restore_expense(p_expense_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_e public.expenses; v_users uuid[]; v_u uuid;
begin
  select * into v_e from public.expenses where id = p_expense_id for update;
  if v_e.id is null or not public.can_view_expense(v_e.id, v_uid) then perform public._err('NOT_FOUND', 'Expense not found.'); end if;
  if v_e.deleted_at is null then return jsonb_build_object('expense_id', v_e.id, 'version', v_e.version, 'already_active', true); end if;
  if not public._can_modify_expense(v_e, v_uid) then perform public._err('FORBIDDEN', 'You don’t have permission to restore this expense.'); end if;
  if v_e.group_id is not null and exists (select 1 from public.groups g where g.id = v_e.group_id and (g.archived_at is not null or g.deleted_at is not null)) then
    perform public._err('GROUP_ARCHIVED', 'Unarchive the group before restoring expenses.');
  end if;
  -- Everyone involved must still be eligible (members / friends).
  select array_agg(distinct u) into v_users from (
    select user_id as u from public.expense_payers where expense_id = v_e.id union select user_id from public.expense_participants where expense_id = v_e.id) z;
  if v_e.group_id is not null then
    foreach v_u in array v_users loop
      if not public.is_group_member(v_e.group_id, v_u) then perform public._err('NOT_GROUP_MEMBER', 'Someone on this expense has left the group, so it cannot be restored.'); end if;
    end loop;
  end if;

  update public.expenses set deleted_at = null, deleted_by = null, version = version + 1 where id = v_e.id;
  perform public._apply_expense_ledger(v_e.id, v_uid);
  insert into public.expense_revisions (expense_id, version, change_type, snapshot, changed_by)
  values (v_e.id, v_e.version + 1, 'restored', public._expense_snapshot(v_e.id), v_uid);
  perform public._log_activity(v_e.group_id, v_uid, 'expense_restored', 'expense', v_e.id,
    jsonb_build_object('description', v_e.description, 'amount_minor', v_e.amount_minor, 'currency', v_e.currency),
    case when v_e.group_id is null then v_users else '{}' end);
  return jsonb_build_object('expense_id', v_e.id, 'version', v_e.version + 1);
end $$;

-- ---------- Settlements ------------------------------------------------------
create or replace function public._record_settlement_core(p jsonb, p_actor uuid, p_is_demo boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_payer uuid := (p ->> 'payer_id')::uuid;
  v_payee uuid := (p ->> 'payee_id')::uuid;
  v_amount bigint := public._jint(p, 'amount_minor', 'Amount');
  v_currency text := p ->> 'currency';
  v_date date;
  v_id uuid;
  v_method text := coalesce(p ->> 'method', 'cash');
begin
  if v_payer is null or v_payee is null or v_payer = v_payee then perform public._err('INVALID_PARTIES', 'Choose two different people.'); end if;
  if p_actor not in (v_payer, v_payee) then perform public._err('FORBIDDEN', 'Only the people involved can record a repayment.'); end if;
  if v_amount <= 0 or v_amount > 1000000000000 then perform public._err('INVALID_AMOUNT', 'Amount must be greater than zero.'); end if;
  if not exists (select 1 from public.currencies where code = v_currency) then perform public._err('INVALID_CURRENCY', 'Unsupported currency.'); end if;
  if v_method not in ('cash', 'upi', 'bank_transfer', 'card', 'other') then perform public._err('INVALID_METHOD', 'Unknown payment method.'); end if;
  begin
    v_date := coalesce((p ->> 'settled_on')::date, current_date);
  exception when others then perform public._err('INVALID_DATE', 'Use a valid date.');
  end;
  if v_date > current_date + 1 or v_date < date '2000-01-01' then perform public._err('INVALID_DATE', 'Repayments cannot be dated in the future.'); end if;
  if char_length(coalesce(p ->> 'note', '')) > 500 then perform public._err('INVALID_NOTE', 'Notes are limited to 500 characters.'); end if;

  if v_group is not null then
    if not exists (select 1 from public.groups g where g.id = v_group and g.deleted_at is null and g.archived_at is null) then
      perform public._err('GROUP_ARCHIVED', 'This group is archived or no longer exists.');
    end if;
    if not public.is_group_member(v_group, v_payer) or not public.is_group_member(v_group, v_payee) then
      perform public._err('NOT_GROUP_MEMBER', 'Both people must be members of the group.');
    end if;
  elsif not public.are_friends(v_payer, v_payee) then
    perform public._err('NOT_FRIENDS', 'You can only record repayments with friends.');
  end if;

  insert into public.settlements (group_id, payer_id, payee_id, amount_minor, currency, settled_on, method, note, created_by, is_demo)
  values (v_group, v_payer, v_payee, v_amount, v_currency, v_date, v_method::public.settlement_method, nullif(trim(coalesce(p ->> 'note', '')), ''), p_actor, p_is_demo)
  returning id into v_id;

  -- Payer handed money to payee → payee now "owes" payer, cancelling the debt.
  insert into public.ledger_entries (group_id, currency, debtor_id, creditor_id, amount_minor, source_type, source_id, created_by)
  values (v_group, v_currency, v_payee, v_payer, v_amount, 'settlement', v_id, p_actor);

  perform public._log_activity(v_group, p_actor, 'settlement_recorded', 'settlement', v_id,
    jsonb_build_object('payer_id', v_payer, 'payee_id', v_payee, 'amount_minor', v_amount, 'currency', v_currency),
    case when v_group is null then array[v_payer, v_payee] else '{}' end);
  perform public._notify(case when p_actor = v_payer then v_payee else v_payer end, 'settlement_recorded',
    public._display_name(p_actor) || ' recorded a repayment',
    public._display_name(v_payer) || ' paid ' || public._display_name(v_payee) || ' ' || public._fmt_amount(v_amount, v_currency) || '. Recorded in Owenil only — no money was moved by the app.',
    '/settlements', jsonb_build_object('settlement_id', v_id));
  return v_id;
end $$;

create or replace function public.record_settlement(p_payload jsonb, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_replay jsonb; v_id uuid; v_result jsonb;
begin
  v_replay := public._idem_begin(v_uid, p_idempotency_key, 'record_settlement', p_payload);
  if v_replay is not null then return v_replay; end if;
  perform public._rate_limit(v_uid, 'settlement_write', 200, interval '1 hour');
  v_id := public._record_settlement_core(p_payload, v_uid);
  v_result := jsonb_build_object('settlement_id', v_id);
  perform public._idem_finish(v_uid, p_idempotency_key, v_result);
  return v_result;
end $$;

create or replace function public.reverse_settlement(p_settlement_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_s public.settlements;
begin
  select * into v_s from public.settlements where id = p_settlement_id for update;
  if v_s.id is null or not public.can_view_settlement(v_s.id, v_uid) then perform public._err('NOT_FOUND', 'Repayment not found.'); end if;
  if v_s.reversed_at is not null then return jsonb_build_object('settlement_id', v_s.id, 'already_reversed', true); end if;
  if not (v_uid in (v_s.payer_id, v_s.payee_id, v_s.created_by) or (v_s.group_id is not null and public.is_group_admin(v_s.group_id, v_uid))) then
    perform public._err('FORBIDDEN', 'You don’t have permission to reverse this repayment.');
  end if;
  perform public._reverse_source_ledger('settlement', v_s.id, v_uid);
  update public.settlements set reversed_at = now(), reversed_by = v_uid, reversal_reason = left(nullif(trim(coalesce(p_reason, '')), ''), 300) where id = v_s.id;
  perform public._log_activity(v_s.group_id, v_uid, 'settlement_reversed', 'settlement', v_s.id,
    jsonb_build_object('payer_id', v_s.payer_id, 'payee_id', v_s.payee_id, 'amount_minor', v_s.amount_minor, 'currency', v_s.currency, 'reason', p_reason),
    case when v_s.group_id is null then array[v_s.payer_id, v_s.payee_id] else '{}' end);
  perform public._notify(case when v_uid = v_s.payer_id then v_s.payee_id else v_s.payer_id end, 'settlement_reversed',
    public._display_name(v_uid) || ' reversed a repayment', public._fmt_amount(v_s.amount_minor, v_s.currency), '/settlements');
  return jsonb_build_object('settlement_id', v_s.id);
end $$;

-- ---------- Groups -----------------------------------------------------------
create or replace function public.create_group(
  p_name text, p_description text default '', p_group_type text default 'other', p_currency text default 'INR',
  p_emoji text default '✨', p_color text default '#14b8a6', p_simplify boolean default true, p_member_ids uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_id uuid; v_m uuid;
begin
  perform public._rate_limit(v_uid, 'group_create', 30, interval '1 hour');
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 60 then perform public._err('INVALID_NAME', 'Group names need 2–60 characters.'); end if;
  if p_group_type not in ('travel', 'home', 'couple', 'family', 'outing', 'other') then perform public._err('INVALID_TYPE', 'Unknown group type.'); end if;
  if not exists (select 1 from public.currencies where code = upper(p_currency)) then perform public._err('INVALID_CURRENCY', 'Unsupported currency.'); end if;
  insert into public.groups (name, description, group_type, default_currency, emoji, color, simplify_debts, created_by)
  values (trim(p_name), coalesce(trim(p_description), ''), p_group_type, upper(p_currency), coalesce(nullif(p_emoji, ''), '✨'), p_color, p_simplify, v_uid)
  returning id into v_id;
  insert into public.group_members (group_id, user_id, role, added_by) values (v_id, v_uid, 'owner', v_uid);
  foreach v_m in array coalesce(p_member_ids, '{}') loop
    if v_m <> v_uid then
      if not public.are_friends(v_uid, v_m) then perform public._err('NOT_FRIENDS', 'You can add friends directly; invite others with a link.'); end if;
      insert into public.group_members (group_id, user_id, role, added_by) values (v_id, v_m, 'member', v_uid) on conflict do nothing;
      perform public._notify(v_m, 'group_added', public._display_name(v_uid) || ' added you to ' || trim(p_name), null, '/groups/' || v_id);
    end if;
  end loop;
  perform public._log_activity(v_id, v_uid, 'group_created', 'group', v_id, jsonb_build_object('name', trim(p_name)));
  return v_id;
end $$;

create or replace function public.add_group_members(p_group_id uuid, p_user_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_m uuid; v_n integer := 0; v_name text;
begin
  if not public.is_group_member(p_group_id, v_uid) then perform public._err('FORBIDDEN', 'You are not a member of this group.'); end if;
  select name into v_name from public.groups where id = p_group_id and deleted_at is null and archived_at is null;
  if v_name is null then perform public._err('GROUP_ARCHIVED', 'This group is archived.'); end if;
  foreach v_m in array coalesce(p_user_ids, '{}') loop
    if not public.are_friends(v_uid, v_m) then perform public._err('NOT_FRIENDS', 'You can add friends directly; invite others with a link.'); end if;
    insert into public.group_members (group_id, user_id, role, added_by) values (p_group_id, v_m, 'member', v_uid)
    on conflict (group_id, user_id) do update set status = 'active', role = 'member', left_at = null, joined_at = now(), added_by = v_uid
      where public.group_members.status <> 'active';
    if found then
      v_n := v_n + 1;
      perform public._log_activity(p_group_id, v_uid, 'member_added', 'profile', v_m, jsonb_build_object('user_id', v_m));
      perform public._notify(v_m, 'group_added', public._display_name(v_uid) || ' added you to ' || v_name, null, '/groups/' || p_group_id);
    end if;
  end loop;
  return v_n;
end $$;

create or replace function public.create_group_invitation(p_group_id uuid, p_role text default 'member', p_max_uses integer default 25, p_valid_days integer default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_token text := public._new_token(); v_id uuid;
begin
  if not public.is_group_member(p_group_id, v_uid) then perform public._err('FORBIDDEN', 'You are not a member of this group.'); end if;
  if p_role not in ('member', 'admin') then perform public._err('INVALID_ROLE', 'Invalid role.'); end if;
  if p_role = 'admin' and not public.is_group_admin(p_group_id, v_uid) then perform public._err('FORBIDDEN', 'Only admins can invite admins.'); end if;
  if exists (select 1 from public.groups where id = p_group_id and archived_at is not null) then perform public._err('GROUP_ARCHIVED', 'This group is archived.'); end if;
  perform public._rate_limit(v_uid, 'invitation', 60, interval '1 hour');
  insert into public.group_invitations (group_id, created_by, token_hash, role, max_uses, expires_at)
  values (p_group_id, v_uid, public._token_hash(v_token), p_role::public.group_role, greatest(1, least(coalesce(p_max_uses, 25), 500)),
          now() + make_interval(days => greatest(1, least(coalesce(p_valid_days, 7), 30))))
  returning id into v_id;
  return jsonb_build_object('invitation_id', v_id, 'token', v_token);
end $$;

create or replace function public.revoke_group_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_i public.group_invitations;
begin
  select * into v_i from public.group_invitations where id = p_invitation_id;
  if v_i.id is null or not (v_i.created_by = v_uid or public.is_group_admin(v_i.group_id, v_uid)) then
    perform public._err('FORBIDDEN', 'You cannot revoke this invitation.');
  end if;
  update public.group_invitations set revoked_at = coalesce(revoked_at, now()) where id = p_invitation_id;
end $$;

-- Safe preview of an invitation link (only shows what the invitee needs).
create or replace function public.preview_invitation(p_kind text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_gi public.group_invitations; v_fi public.friendship_invitations; v_g public.groups;
begin
  if p_kind = 'group' then
    select * into v_gi from public.group_invitations where token_hash = public._token_hash(p_token);
    if v_gi.id is null then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
    select * into v_g from public.groups where id = v_gi.group_id;
    return jsonb_build_object(
      'valid', v_gi.revoked_at is null and v_gi.expires_at > now() and v_gi.use_count < v_gi.max_uses and v_g.deleted_at is null and v_g.archived_at is null,
      'reason', case when v_gi.revoked_at is not null then 'revoked' when v_gi.expires_at <= now() then 'expired'
                     when v_gi.use_count >= v_gi.max_uses then 'used_up' when v_g.deleted_at is not null or v_g.archived_at is not null then 'archived' else null end,
      'group_name', v_g.name, 'group_emoji', v_g.emoji, 'group_color', v_g.color,
      'member_count', (select count(*) from public.group_members m where m.group_id = v_g.id and m.status = 'active'),
      'inviter_name', public._display_name(v_gi.created_by),
      'already_member', public.is_group_member(v_g.id, v_uid), 'group_id', case when public.is_group_member(v_g.id, v_uid) then v_g.id end);
  elsif p_kind = 'friend' then
    select * into v_fi from public.friendship_invitations where token_hash = public._token_hash(p_token);
    if v_fi.id is null then return jsonb_build_object('valid', false, 'reason', 'not_found'); end if;
    return jsonb_build_object(
      'valid', v_fi.status = 'pending' and v_fi.expires_at > now() and v_fi.inviter_id <> v_uid,
      'reason', case when v_fi.inviter_id = v_uid then 'own_invitation' when v_fi.status <> 'pending' then v_fi.status::text
                     when v_fi.expires_at <= now() then 'expired' else null end,
      'inviter_name', public._display_name(v_fi.inviter_id),
      'already_friends', public.are_friends(v_uid, v_fi.inviter_id));
  end if;
  return jsonb_build_object('valid', false, 'reason', 'unknown_kind');
end $$;

create or replace function public.accept_group_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_i public.group_invitations; v_g public.groups;
begin
  perform public._rate_limit(v_uid, 'invitation_accept', 60, interval '1 hour');
  select * into v_i from public.group_invitations where token_hash = public._token_hash(p_token) for update;
  if v_i.id is null then perform public._err('INVITATION_INVALID', 'This invitation link is not valid.'); end if;
  select * into v_g from public.groups where id = v_i.group_id;
  if public.is_group_member(v_g.id, v_uid) then return v_g.id; end if;
  if v_i.revoked_at is not null or v_i.expires_at <= now() or v_i.use_count >= v_i.max_uses then
    perform public._err('INVITATION_EXPIRED', 'This invitation has expired or was revoked. Ask for a new link.');
  end if;
  if v_g.deleted_at is not null or v_g.archived_at is not null then perform public._err('GROUP_ARCHIVED', 'This group is no longer active.'); end if;
  insert into public.group_members (group_id, user_id, role, added_by) values (v_g.id, v_uid, v_i.role, v_i.created_by)
  on conflict (group_id, user_id) do update set status = 'active', role = excluded.role, left_at = null, joined_at = now();
  update public.group_invitations set use_count = use_count + 1 where id = v_i.id;
  perform public._log_activity(v_g.id, v_uid, 'member_joined', 'profile', v_uid, jsonb_build_object('user_id', v_uid));
  perform public._notify(v_i.created_by, 'group_joined', public._display_name(v_uid) || ' joined ' || v_g.name, null, '/groups/' || v_g.id);
  return v_g.id;
end $$;

create or replace function public.set_group_member_role(p_group_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_my public.group_role := public.group_role_of(p_group_id, v_uid); v_their public.group_role := public.group_role_of(p_group_id, p_user_id);
begin
  if v_my is null then perform public._err('FORBIDDEN', 'You are not a member of this group.'); end if;
  if v_their is null then perform public._err('NOT_GROUP_MEMBER', 'That person is not a member of this group.'); end if;
  if p_role not in ('owner', 'admin', 'member') then perform public._err('INVALID_ROLE', 'Invalid role.'); end if;
  if p_role = 'owner' then
    if v_my <> 'owner' then perform public._err('FORBIDDEN', 'Only the owner can transfer ownership.'); end if;
    update public.group_members set role = 'admin' where group_id = p_group_id and user_id = v_uid;
    update public.group_members set role = 'owner' where group_id = p_group_id and user_id = p_user_id;
  else
    if v_their = 'owner' then perform public._err('FORBIDDEN', 'Transfer ownership before changing the owner''s role.'); end if;
    if not coalesce(v_my = 'owner' or (v_my = 'admin' and v_their = 'member' and p_role = 'admin'), false) then
      perform public._err('FORBIDDEN', 'You don’t have permission to change this role.');
    end if;
    update public.group_members set role = p_role::public.group_role where group_id = p_group_id and user_id = p_user_id;
  end if;
  perform public._log_activity(p_group_id, v_uid, 'member_role_changed', 'profile', p_user_id, jsonb_build_object('user_id', p_user_id, 'role', p_role));
end $$;

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_my public.group_role := public.group_role_of(p_group_id, v_uid); v_their public.group_role := public.group_role_of(p_group_id, p_user_id);
begin
  if v_my is null then perform public._err('FORBIDDEN', 'You are not a member of this group.'); end if;
  if v_their is null then perform public._err('NOT_GROUP_MEMBER', 'That person is not a member of this group.'); end if;
  if p_user_id = v_uid then perform public._err('USE_LEAVE', 'Use “Leave group” to remove yourself.'); end if;
  if not coalesce((v_my = 'owner' and v_their <> 'owner') or (v_my = 'admin' and v_their = 'member'), false) then
    perform public._err('FORBIDDEN', 'You don’t have permission to remove this member.');
  end if;
  if public._user_has_open_group_balance(p_group_id, p_user_id) then
    perform public._err('BALANCE_NOT_SETTLED', 'This member still has an unsettled balance in the group. Settle up first.');
  end if;
  update public.group_members set status = 'removed', left_at = now() where group_id = p_group_id and user_id = p_user_id;
  perform public._log_activity(p_group_id, v_uid, 'member_removed', 'profile', p_user_id, jsonb_build_object('user_id', p_user_id));
  perform public._notify(p_user_id, 'group_removed', 'You were removed from a group', (select name from public.groups where id = p_group_id), null);
end $$;

create or replace function public.leave_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_role public.group_role := public.group_role_of(p_group_id, v_uid); v_others integer;
begin
  if v_role is null then perform public._err('NOT_GROUP_MEMBER', 'You are not a member of this group.'); end if;
  if public._user_has_open_group_balance(p_group_id, v_uid) then
    perform public._err('BALANCE_NOT_SETTLED', 'You still have an unsettled balance in this group. Settle up before leaving.');
  end if;
  select count(*) into v_others from public.group_members where group_id = p_group_id and status = 'active' and user_id <> v_uid;
  if v_role = 'owner' and v_others > 0 then
    perform public._err('OWNER_MUST_TRANSFER', 'Make someone else the owner before you leave.');
  end if;
  update public.group_members set status = 'left', left_at = now() where group_id = p_group_id and user_id = v_uid;
  if v_others = 0 then update public.groups set archived_at = coalesce(archived_at, now()) where id = p_group_id; end if;
  perform public._log_activity(p_group_id, v_uid, 'member_left', 'profile', v_uid, jsonb_build_object('user_id', v_uid));
end $$;

create or replace function public.set_group_archived(p_group_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  if not public.is_group_admin(p_group_id, v_uid) then perform public._err('FORBIDDEN', 'Only group admins can archive a group.'); end if;
  update public.groups set archived_at = case when p_archived then coalesce(archived_at, now()) else null end where id = p_group_id;
  perform public._log_activity(p_group_id, v_uid, case when p_archived then 'group_archived' else 'group_unarchived' end, 'group', p_group_id, '{}');
end $$;

create or replace function public.delete_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  if public.group_role_of(p_group_id, v_uid) is distinct from 'owner' then perform public._err('FORBIDDEN', 'Only the owner can delete a group.'); end if;
  if exists (select 1 from public._group_nets(p_group_id)) then
    perform public._err('BALANCE_NOT_SETTLED', 'All balances must be settled before the group can be deleted. You can archive it instead.');
  end if;
  update public.groups set deleted_at = now(), archived_at = coalesce(archived_at, now()) where id = p_group_id;
  update public.group_invitations set revoked_at = coalesce(revoked_at, now()) where group_id = p_group_id;
  update public.recurring_expense_templates set status = 'cancelled' where group_id = p_group_id and status <> 'cancelled';
end $$;

-- ---------- Friends ----------------------------------------------------------
create or replace function public._make_friends(p_a uuid, p_b uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.friendships (user_a, user_b) values (least(p_a, p_b), greatest(p_a, p_b))
  on conflict (user_a, user_b) do update set removed_at = null, created_at = case when public.friendships.removed_at is null then public.friendships.created_at else now() end;
$$;

-- Creates an invitation link; optionally addressed to an email. The response
-- never reveals whether the email belongs to an existing account.
create or replace function public.create_friend_invitation(p_email text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._uid();
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_token text := public._new_token();
  v_target uuid;
  v_id uuid;
begin
  perform public._rate_limit(v_uid, 'invitation', 60, interval '1 hour');
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._err('INVALID_EMAIL', 'Enter a valid email address.'); end if;
  if v_email is not null then
    select u.id into v_target from auth.users u join public.user_preferences up on up.user_id = u.id
     where lower(u.email) = v_email and up.discoverable_by_email;
    if v_target = v_uid then perform public._err('INVALID_EMAIL', 'That’s your own email address.'); end if;
    update public.friendship_invitations set status = 'revoked'
     where inviter_id = v_uid and invitee_email = v_email and status = 'pending';
  end if;
  insert into public.friendship_invitations (inviter_id, invitee_email, invitee_id, token_hash)
  values (v_uid, v_email, v_target, public._token_hash(v_token))
  returning id into v_id;
  if v_target is not null and not public.are_friends(v_uid, v_target) then
    perform public._notify(v_target, 'friend_invite', public._display_name(v_uid) || ' wants to be friends on Owenil', null, '/friends');
  end if;
  return jsonb_build_object('invitation_id', v_id, 'token', v_token);
end $$;

create or replace function public.accept_friend_invitation(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_i public.friendship_invitations;
begin
  perform public._rate_limit(v_uid, 'invitation_accept', 60, interval '1 hour');
  select * into v_i from public.friendship_invitations where token_hash = public._token_hash(p_token) for update;
  if v_i.id is null then perform public._err('INVITATION_INVALID', 'This invitation link is not valid.'); end if;
  if v_i.inviter_id = v_uid then perform public._err('OWN_INVITATION', 'This is your own invitation link — share it with a friend.'); end if;
  if public.are_friends(v_uid, v_i.inviter_id) then return v_i.inviter_id; end if;
  if v_i.status <> 'pending' or v_i.expires_at <= now() then perform public._err('INVITATION_EXPIRED', 'This invitation has expired. Ask for a new link.'); end if;
  perform public._make_friends(v_uid, v_i.inviter_id);
  update public.friendship_invitations set status = 'accepted', responded_at = now(), invitee_id = v_uid where id = v_i.id;
  -- Close any other pending invitations between the two people.
  update public.friendship_invitations set status = 'accepted', responded_at = now()
   where status = 'pending' and ((inviter_id = v_uid and invitee_id = v_i.inviter_id) or (inviter_id = v_i.inviter_id and invitee_id = v_uid));
  perform public._log_activity(null, v_uid, 'friend_added', 'profile', v_i.inviter_id, '{}', array[v_uid, v_i.inviter_id]);
  perform public._notify(v_i.inviter_id, 'friend_accepted', public._display_name(v_uid) || ' accepted your friend invitation', null, '/friends/' || v_uid);
  return v_i.inviter_id;
end $$;

create or replace function public.respond_friend_invitation(p_invitation_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_i public.friendship_invitations;
begin
  select * into v_i from public.friendship_invitations where id = p_invitation_id and invitee_id = v_uid for update;
  if v_i.id is null or v_i.status <> 'pending' or v_i.expires_at <= now() then
    perform public._err('INVITATION_INVALID', 'This invitation is no longer available.');
  end if;
  if p_accept then
    perform public._make_friends(v_uid, v_i.inviter_id);
    update public.friendship_invitations set status = 'accepted', responded_at = now() where id = v_i.id;
    perform public._log_activity(null, v_uid, 'friend_added', 'profile', v_i.inviter_id, '{}', array[v_uid, v_i.inviter_id]);
    perform public._notify(v_i.inviter_id, 'friend_accepted', public._display_name(v_uid) || ' accepted your friend invitation', null, '/friends/' || v_uid);
  else
    update public.friendship_invitations set status = 'declined', responded_at = now() where id = v_i.id;
  end if;
  return v_i.inviter_id;
end $$;

create or replace function public.revoke_friend_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  update public.friendship_invitations set status = 'revoked', responded_at = now()
   where id = p_invitation_id and inviter_id = v_uid and status = 'pending';
  if not found then perform public._err('NOT_FOUND', 'Invitation not found.'); end if;
end $$;

create or replace function public.remove_friend(p_friend_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  if exists (
    select 1 from (
      select le.currency, case when le.creditor_id = v_uid then le.amount_minor else -le.amount_minor end as delta
        from public.ledger_entries le
       where le.group_id is null and ((le.creditor_id = v_uid and le.debtor_id = p_friend_id) or (le.debtor_id = v_uid and le.creditor_id = p_friend_id))
    ) x group by x.currency having sum(x.delta) <> 0) then
    perform public._err('BALANCE_NOT_SETTLED', 'Settle your non-group balance with this friend before removing them.');
  end if;
  update public.friendships set removed_at = now()
   where user_a = least(v_uid, p_friend_id) and user_b = greatest(v_uid, p_friend_id) and removed_at is null;
  if not found then perform public._err('NOT_FOUND', 'You are not friends with this person.'); end if;
end $$;

-- ---------- Recurring expenses -----------------------------------------------
create or replace function public._occurrence_date(p_start date, p_frequency public.recurrence_frequency, p_n integer)
returns date language sql immutable as $$
  select case p_frequency
    when 'weekly' then p_start + 7 * p_n
    when 'monthly' then (p_start + make_interval(months => p_n))::date
    when 'quarterly' then (p_start + make_interval(months => 3 * p_n))::date
    when 'yearly' then (p_start + make_interval(years => p_n))::date
  end;
$$;

create or replace function public._user_today(p_user uuid)
returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from public.profiles where id = p_user), 'UTC'))::date;
$$;

-- Generates every due occurrence for active templates. Safe to run repeatedly:
-- the unique (template_id, occurrence_date) constraint makes each occurrence
-- exactly-once even if two runs overlap. Scheduled hourly via pg_cron.
create or replace function public.generate_due_recurring_expenses(p_only_user uuid default null, p_template_id uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  t public.recurring_expense_templates;
  v_today date; v_date date; v_occ uuid; v_expense uuid; v_created integer := 0; v_payload jsonb; v_idx integer; v_err text;
begin
  for t in
    select * from public.recurring_expense_templates rt
     where rt.status = 'active' and rt.next_occurrence_on is not null
       and (p_template_id is null or rt.id = p_template_id)
       and (p_only_user is null or rt.created_by = p_only_user
            or (rt.group_id is not null and public.is_group_member(rt.group_id, p_only_user)))
     order by rt.next_occurrence_on
     for update skip locked
  loop
    v_today := public._user_today(t.created_by);
    v_idx := t.next_index;
    v_err := null;
    loop
      v_date := public._occurrence_date(t.start_date, t.frequency, v_idx);
      exit when v_date > v_today or (t.end_date is not null and v_date > t.end_date);
      begin
        insert into public.recurring_expense_occurrences (template_id, occurrence_index, occurrence_date, status)
        values (t.id, v_idx, v_date, 'created')
        on conflict do nothing
        returning id into v_occ;
        if v_occ is not null then
          v_payload := t.payload || jsonb_build_object(
            'group_id', t.group_id, 'description', t.description, 'amount_minor', t.amount_minor,
            'currency', t.currency, 'category_id', t.category_id, 'expense_date', v_date);
          v_expense := public._create_expense_core(v_payload, t.created_by, t.id, t.is_demo);
          update public.recurring_expense_occurrences set expense_id = v_expense where id = v_occ;
          v_created := v_created + 1;
        end if;
      exception when others then
        v_err := sqlerrm;
      end;
      if v_err is not null then
        insert into public.recurring_expense_occurrences (template_id, occurrence_index, occurrence_date, status, error)
        values (t.id, v_idx, v_date, 'failed', left(v_err, 500)) on conflict do nothing;
        update public.recurring_expense_templates set status = 'paused', last_error = left(v_err, 500), next_index = v_idx,
               next_occurrence_on = v_date where id = t.id;
        perform public._notify(t.created_by, 'recurring_failed', 'Recurring expense paused: ' || t.description,
          'It could not be created for ' || v_date || ': ' || left(v_err, 200), '/recurring');
        exit;
      end if;
      v_idx := v_idx + 1;
    end loop;
    if v_err is null then
      v_date := public._occurrence_date(t.start_date, t.frequency, v_idx);
      update public.recurring_expense_templates
         set next_index = v_idx,
             next_occurrence_on = case when t.end_date is not null and v_date > t.end_date then null else v_date end,
             last_error = null
       where id = t.id;
    end if;
  end loop;
  return v_created;
end $$;

create or replace function public._validate_recurring(p_payload jsonb, p_frequency text, p_start date, p_end date, p_user uuid, p_template_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_active integer;
begin
  if p_frequency not in ('weekly', 'monthly', 'quarterly', 'yearly') then perform public._err('INVALID_FREQUENCY', 'Choose a schedule.'); end if;
  if p_start is null or p_start < current_date - 366 or p_start > current_date + 3660 then perform public._err('INVALID_DATE', 'Choose a valid start date.'); end if;
  if p_end is not null and p_end < p_start then perform public._err('INVALID_DATE', 'The end date must be after the start date.'); end if;
  if (p_payload ->> 'split_method') = 'itemized' then perform public._err('INVALID_SPLIT_METHOD', 'Itemized splits cannot repeat.'); end if;
  if not public.is_premium(p_user) then
    if p_frequency in ('quarterly', 'yearly') then
      perform public._err('PREMIUM_REQUIRED', 'Quarterly and yearly schedules are Owenil Plus features.');
    end if;
    select count(*) into v_active from public.recurring_expense_templates
     where created_by = p_user and status <> 'cancelled' and id is distinct from p_template_id;
    if v_active >= 3 then perform public._err('PREMIUM_REQUIRED', 'Free accounts can have up to 3 recurring expenses. Upgrade to Owenil Plus for unlimited.'); end if;
  end if;
end $$;

create or replace function public.create_recurring_template(p_payload jsonb, p_frequency text, p_start_date date, p_end_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_group uuid := nullif(p_payload ->> 'group_id', '')::uuid; v_id uuid; v_clean jsonb;
begin
  perform public._rate_limit(v_uid, 'recurring_write', 60, interval '1 hour');
  perform public._validate_recurring(p_payload, p_frequency, p_start_date, p_end_date, v_uid, null);
  if v_group is not null and not public.is_group_member(v_group, v_uid) then perform public._err('FORBIDDEN', 'You are not a member of this group.'); end if;
  perform public._validate_expense_payload(p_payload || jsonb_build_object('expense_date', greatest(p_start_date, current_date)), v_group, v_uid);
  v_clean := jsonb_build_object('split_method', p_payload -> 'split_method', 'payers', p_payload -> 'payers', 'participants', p_payload -> 'participants',
                                'splits', p_payload -> 'splits', 'items', '[]'::jsonb, 'notes', p_payload -> 'notes', 'tags', coalesce(p_payload -> 'tags', '[]'));
  insert into public.recurring_expense_templates (created_by, group_id, description, amount_minor, currency, category_id, frequency,
                                                  start_date, end_date, next_index, next_occurrence_on, payload)
  values (v_uid, v_group, trim(p_payload ->> 'description'), (p_payload ->> 'amount_minor')::bigint, p_payload ->> 'currency',
          nullif(p_payload ->> 'category_id', '')::uuid, p_frequency::public.recurrence_frequency, p_start_date, p_end_date, 0, p_start_date, v_clean)
  returning id into v_id;
  perform public._log_activity(v_group, v_uid, 'recurring_created', 'recurring_template', v_id,
    jsonb_build_object('description', trim(p_payload ->> 'description'), 'frequency', p_frequency), '{}');
  perform public.generate_due_recurring_expenses(null, v_id);
  return v_id;
end $$;

create or replace function public._can_manage_template(p_t public.recurring_expense_templates, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_t.created_by = p_user or (p_t.group_id is not null and public.is_group_admin(p_t.group_id, p_user));
$$;

-- Edits apply to future occurrences only; already-created expenses are untouched.
create or replace function public.update_recurring_template(p_template_id uuid, p_payload jsonb, p_frequency text, p_start_date date, p_end_date date default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); t public.recurring_expense_templates; v_clean jsonb; v_restart boolean;
begin
  select * into t from public.recurring_expense_templates where id = p_template_id for update;
  if t.id is null or not public._can_manage_template(t, v_uid) then perform public._err('FORBIDDEN', 'You cannot edit this recurring expense.'); end if;
  if t.status = 'cancelled' then perform public._err('TEMPLATE_CANCELLED', 'This recurring expense was cancelled.'); end if;
  perform public._validate_recurring(p_payload, p_frequency, p_start_date, p_end_date, t.created_by, t.id);
  perform public._validate_expense_payload(p_payload || jsonb_build_object('group_id', t.group_id, 'expense_date', current_date), t.group_id, t.created_by);
  v_clean := jsonb_build_object('split_method', p_payload -> 'split_method', 'payers', p_payload -> 'payers', 'participants', p_payload -> 'participants',
                                'splits', p_payload -> 'splits', 'items', '[]'::jsonb, 'notes', p_payload -> 'notes', 'tags', coalesce(p_payload -> 'tags', '[]'));
  v_restart := p_frequency::public.recurrence_frequency <> t.frequency or p_start_date <> t.start_date;
  if v_restart and p_start_date <= coalesce((select max(occurrence_date) from public.recurring_expense_occurrences where template_id = t.id), date '1900-01-01') then
    perform public._err('INVALID_DATE', 'A changed schedule must start after the last generated expense.');
  end if;
  update public.recurring_expense_templates set
    description = trim(p_payload ->> 'description'), amount_minor = (p_payload ->> 'amount_minor')::bigint, currency = p_payload ->> 'currency',
    category_id = nullif(p_payload ->> 'category_id', '')::uuid, payload = v_clean, end_date = p_end_date,
    frequency = p_frequency::public.recurrence_frequency, start_date = p_start_date,
    next_index = case when v_restart then 0 else next_index end,
    next_occurrence_on = case when v_restart then p_start_date
                              else (case when p_end_date is not null and public._occurrence_date(t.start_date, t.frequency, t.next_index) > p_end_date then null
                                         else public._occurrence_date(t.start_date, t.frequency, t.next_index) end) end
  where id = t.id;
end $$;

create or replace function public.set_recurring_status(p_template_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); t public.recurring_expense_templates; v_idx integer; v_today date;
begin
  select * into t from public.recurring_expense_templates where id = p_template_id for update;
  if t.id is null or not public._can_manage_template(t, v_uid) then perform public._err('FORBIDDEN', 'You cannot change this recurring expense.'); end if;
  if t.status = 'cancelled' then perform public._err('TEMPLATE_CANCELLED', 'This recurring expense was cancelled.'); end if;
  if p_status = 'paused' then
    update public.recurring_expense_templates set status = 'paused' where id = t.id;
  elsif p_status = 'cancelled' then
    update public.recurring_expense_templates set status = 'cancelled', next_occurrence_on = null where id = t.id;
  elsif p_status = 'active' then
    -- Resuming skips occurrences that fell inside the paused period.
    v_today := public._user_today(t.created_by);
    v_idx := t.next_index;
    while public._occurrence_date(t.start_date, t.frequency, v_idx) < v_today loop
      v_idx := v_idx + 1;
      exit when v_idx > 100000;
    end loop;
    update public.recurring_expense_templates set status = 'active', next_index = v_idx, last_error = null,
      next_occurrence_on = case when t.end_date is not null and public._occurrence_date(t.start_date, t.frequency, v_idx) > t.end_date then null
                                else public._occurrence_date(t.start_date, t.frequency, v_idx) end
     where id = t.id;
    perform public.generate_due_recurring_expenses(null, t.id);
  else
    perform public._err('INVALID_STATUS', 'Invalid status.');
  end if;
  perform public._log_activity(t.group_id, v_uid, 'recurring_' || p_status, 'recurring_template', t.id, jsonb_build_object('description', t.description), '{}');
end $$;

-- Manual trigger (development & "run now"): only generates what is already due.
create or replace function public.run_due_recurring_now()
returns integer language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  perform public._rate_limit(v_uid, 'recurring_run', 30, interval '1 hour');
  return public.generate_due_recurring_expenses(v_uid, null);
end $$;

-- ---------- Analytics --------------------------------------------------------
create or replace function public.get_my_spending(p_from date, p_to date)
returns table (expense_id uuid, expense_date date, description text, currency char(3), category_id uuid, group_id uuid,
               total_minor bigint, my_share_minor bigint, my_paid_minor bigint, is_recurring boolean, payers jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_uid uuid := public._uid();
begin
  if p_to - p_from > 3700 then perform public._err('RANGE_TOO_LARGE', 'Choose a range of at most 10 years.'); end if;
  return query
  select e.id, e.expense_date, e.description, e.currency, e.category_id, e.group_id, e.amount_minor,
         coalesce((select s.amount_minor from public.expense_splits s where s.expense_id = e.id and s.user_id = v_uid), 0)::bigint,
         coalesce((select p.amount_minor from public.expense_payers p where p.expense_id = e.id and p.user_id = v_uid), 0)::bigint,
         e.recurring_template_id is not null,
         coalesce((select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'amount_minor', p.amount_minor)) from public.expense_payers p where p.expense_id = e.id), '[]')
    from public.expenses e
   where e.deleted_at is null and e.expense_date between p_from and p_to
     and e.id in (select s.expense_id from public.expense_splits s where s.user_id = v_uid
                  union select p.expense_id from public.expense_payers p where p.user_id = v_uid)
     and (e.group_id is null or exists (select 1 from public.groups g where g.id = e.group_id and g.deleted_at is null))
   order by e.expense_date;
end $$;

-- ---------- Premium entitlement (development switch) --------------------------
-- There is no payment processing. In development/test projects a tester can
-- toggle Owenil Plus. The switch is controlled by app_settings
-- 'dev_entitlements_mode' ('off' | 'testers' | 'all'), which clients cannot
-- read or change. In production set it to 'off'.
create or replace function public.get_dev_tools_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_mode text;
begin
  select value #>> '{}' into v_mode from public.app_settings where key = 'dev_entitlements_mode';
  v_mode := coalesce(v_mode, 'off');
  return jsonb_build_object('mode', v_mode,
    'premium_switch_allowed', v_mode = 'all' or (v_mode = 'testers' and exists (select 1 from public.profiles where id = v_uid and is_tester)));
end $$;

create or replace function public.dev_set_plan(p_plan text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_status jsonb := public.get_dev_tools_status(); v_old public.plan_tier;
begin
  if not (v_status ->> 'premium_switch_allowed')::boolean then
    perform public._err('DEV_TOOLS_DISABLED', 'The development premium switch is disabled for this account/environment.');
  end if;
  if p_plan not in ('free', 'plus') then perform public._err('INVALID_PLAN', 'Unknown plan.'); end if;
  select plan into v_old from public.subscription_entitlements where user_id = v_uid;
  insert into public.subscription_entitlements (user_id, plan, status, source, current_period_end)
  values (v_uid, p_plan::public.plan_tier, 'active', 'development', null)
  on conflict (user_id) do update set plan = excluded.plan, status = 'active', source = 'development', current_period_end = null;
  insert into public.subscription_events (user_id, event_type, from_plan, to_plan, source, actor_id, details)
  values (v_uid, 'dev_plan_changed', v_old, p_plan::public.plan_tier, 'development', v_uid, jsonb_build_object('mode', v_status ->> 'mode'));
  return jsonb_build_object('plan', p_plan);
end $$;

-- ---------- Privacy: export & deletion ---------------------------------------
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid();
begin
  return jsonb_build_object(
    'exported_at', now(),
    'notice', 'Owenil data export. Amounts are integer minor units (e.g. paise) of the stated currency.',
    'profile', (select to_jsonb(p) - 'is_tester' from public.profiles p where p.id = v_uid),
    'email', (select email from auth.users where id = v_uid),
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

-- Deletes the caller's account. Requires all balances to be settled so other
-- people's records remain correct. Financial history is kept but anonymised.
create or replace function public.delete_my_account(p_confirmation text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_auth_deleted boolean := false;
begin
  if p_confirmation is distinct from 'DELETE' then perform public._err('CONFIRMATION_REQUIRED', 'Type DELETE to confirm.'); end if;
  if public._user_has_any_open_balance(v_uid) then
    perform public._err('BALANCE_NOT_SETTLED', 'Settle all your balances before deleting your account.');
  end if;
  update public.group_members set role = 'admin'
   where user_id = v_uid and role = 'owner' and status = 'active'
     and exists (select 1 from public.group_members o where o.group_id = group_members.group_id and o.user_id <> v_uid and o.status = 'active');
  -- Hand ownership to the longest-standing remaining member.
  update public.group_members m set role = 'owner'
    from (select distinct on (o.group_id) o.id from public.group_members o
           where o.status = 'active' and o.user_id <> v_uid
             and o.group_id in (select group_id from public.group_members where user_id = v_uid and status = 'active')
             and not exists (select 1 from public.group_members x where x.group_id = o.group_id and x.role = 'owner' and x.status = 'active' and x.user_id <> v_uid)
           order by o.group_id, o.joined_at) pick
   where m.id = pick.id;
  update public.group_members set status = 'left', left_at = now(), role = case when role = 'owner' then 'admin'::public.group_role else role end
   where user_id = v_uid and status = 'active';
  update public.friendships set removed_at = coalesce(removed_at, now()) where v_uid in (user_a, user_b);
  update public.friendship_invitations set status = 'revoked' where inviter_id = v_uid and status = 'pending';
  update public.group_invitations set revoked_at = coalesce(revoked_at, now()) where created_by = v_uid;
  update public.recurring_expense_templates set status = 'cancelled', next_occurrence_on = null where created_by = v_uid;
  delete from public.budgets where user_id = v_uid;
  delete from public.exchange_rate_snapshots where user_id = v_uid;
  delete from public.split_templates where owner_id = v_uid;
  delete from public.saved_filters where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  delete from public.idempotency_records where user_id = v_uid;
  delete from public.receipt_metadata where owner_id = v_uid and expense_id is null;
  update public.comments set body = '[deleted]', deleted_at = coalesce(deleted_at, now()) where author_id = v_uid;
  delete from public.user_preferences where user_id = v_uid;
  update public.profiles set display_name = 'Deleted user', avatar_url = null, is_tester = false, deleted_at = now() where id = v_uid;
  begin
    delete from auth.users where id = v_uid;
    v_auth_deleted := true;
  exception when insufficient_privilege then
    v_auth_deleted := false;
  end;
  return jsonb_build_object('deleted', true, 'auth_user_deleted', v_auth_deleted);
end $$;

-- Function privileges are set in 20261014000005_function_privileges.sql

-- ---------- Contacts ---------------------------------------------------------
-- Everyone the caller may see (same rule as can_see_profile), computed with
-- joins instead of evaluating a predicate against every profile row.
create or replace function public.get_visible_profiles()
returns table (id uuid, display_name text, avatar_url text, avatar_color text, default_currency char(3), deleted_at timestamptz, is_demo boolean)
language sql stable security definer set search_path = public as $$
  with me as (select auth.uid() as id),
  ids as (
    select (select id from me) as id
    union select b.user_id from public.group_members a join public.group_members b on b.group_id = a.group_id
           where a.user_id = (select id from me) and a.status = 'active'
    union select case when f.user_a = (select id from me) then f.user_b else f.user_a end
            from public.friendships f where (select id from me) in (f.user_a, f.user_b)
    union select i.inviter_id from public.friendship_invitations i where i.invitee_id = (select id from me) and i.status = 'pending'
    union select i.invitee_id from public.friendship_invitations i where i.inviter_id = (select id from me) and i.status = 'pending' and i.invitee_id is not null
    union select y.user_id from public.expense_participants x join public.expense_participants y on y.expense_id = x.expense_id where x.user_id = (select id from me)
    union select y.user_id from public.expense_payers x join public.expense_participants y on y.expense_id = x.expense_id where x.user_id = (select id from me)
    union select x.user_id from public.expense_payers x join public.expense_participants y on y.expense_id = x.expense_id where y.user_id = (select id from me)
    union select case when s.payer_id = (select id from me) then s.payee_id else s.payer_id end
            from public.settlements s where (select id from me) in (s.payer_id, s.payee_id)
  )
  select p.id, p.display_name, p.avatar_url, p.avatar_color, p.default_currency, p.deleted_at, p.is_demo
    from public.profiles p join ids on ids.id = p.id
   where (select id from me) is not null;
$$;

-- ---------- Comment notifications --------------------------------------------
create or replace function public._on_comment_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_e public.expenses; v_u uuid;
begin
  if new.expense_id is null then return new; end if;
  select * into v_e from public.expenses where id = new.expense_id;
  for v_u in
    select user_id from public.expense_participants where expense_id = new.expense_id
    union select user_id from public.expense_payers where expense_id = new.expense_id
  loop
    if v_u <> new.author_id then
      perform public._notify(v_u, 'comment_added', public._display_name(new.author_id) || ' commented on “' || v_e.description || '”',
        left(new.body, 140), '/expenses/' || new.expense_id, jsonb_build_object('expense_id', new.expense_id));
    end if;
  end loop;
  return new;
end $$;
create trigger comments_notify after insert on public.comments for each row execute function public._on_comment_insert();
