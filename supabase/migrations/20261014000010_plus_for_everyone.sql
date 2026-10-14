-- =============================================================================
-- Owenil — "Plus for everyone" testing mode
--
-- dev_entitlements_mode gains a fourth value:
--   off       no development Plus (production)
--   testers   accounts marked is_tester can switch Plus on/off for themselves
--   all       every account can switch Plus on/off for itself
--   everyone  every account HAS Plus (existing and new sign-ups); anyone can
--             still switch back to Free to try the free experience
--
-- Changing the mode goes through set_dev_entitlements_mode(), which only the
-- service role (local admin scripts) can call — never the browser. Every
-- grant/revoke is logged in subscription_events. Leaving "everyone" (or going
-- "off") revokes only Plus that came from development, never real purchases.
-- =============================================================================

create or replace function public.get_dev_tools_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public._uid(); v_mode text;
begin
  select value #>> '{}' into v_mode from public.app_settings where key = 'dev_entitlements_mode';
  v_mode := coalesce(v_mode, 'off');
  return jsonb_build_object('mode', v_mode,
    'premium_switch_allowed', v_mode in ('all', 'everyone') or (v_mode = 'testers' and exists (select 1 from public.profiles where id = v_uid and is_tester)));
end $$;

create or replace function public.set_dev_entitlements_mode(p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_granted integer := 0;
  v_revoked integer := 0;
begin
  if p_mode not in ('off', 'testers', 'all', 'everyone') then
    perform public._err('INVALID_MODE', 'Mode must be off, testers, all or everyone.');
  end if;
  select value #>> '{}' into v_old from public.app_settings where key = 'dev_entitlements_mode';
  insert into public.app_settings (key, value) values ('dev_entitlements_mode', to_jsonb(p_mode))
  on conflict (key) do update set value = excluded.value, updated_at = now();

  if p_mode = 'everyone' then
    with changed as (
      update public.subscription_entitlements s
         set plan = 'plus', status = 'active', source = 'development', current_period_end = null
       where not (s.plan = 'plus' and s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()))
         and exists (select 1 from public.profiles p where p.id = s.user_id and p.deleted_at is null)
      returning s.user_id
    ), logged as (
      insert into public.subscription_events (user_id, event_type, from_plan, to_plan, source, details)
      select user_id, 'dev_plan_changed', 'free', 'plus', 'development', jsonb_build_object('mode', 'everyone', 'bulk', true) from changed
      returning 1
    )
    select count(*) into v_granted from logged;
  elsif p_mode = 'off' or v_old = 'everyone' then
    with changed as (
      update public.subscription_entitlements s
         set plan = 'free', status = 'active', source = 'default', current_period_end = null
       where s.source = 'development' and s.plan = 'plus'
      returning s.user_id
    ), logged as (
      insert into public.subscription_events (user_id, event_type, from_plan, to_plan, source, details)
      select user_id, 'dev_plan_changed', 'plus', 'free', 'development', jsonb_build_object('mode', p_mode, 'bulk', true, 'previous_mode', v_old) from changed
      returning 1
    )
    select count(*) into v_revoked from logged;
  end if;
  return jsonb_build_object('mode', p_mode, 'previous_mode', v_old, 'granted', v_granted, 'revoked', v_revoked);
end $$;

-- New accounts get Plus automatically while the mode is "everyone".
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''));
  v_currency text := upper(coalesce(new.raw_user_meta_data ->> 'default_currency', 'INR'));
  v_tz text := coalesce(new.raw_user_meta_data ->> 'timezone', 'Asia/Kolkata');
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

revoke execute on function public.set_dev_entitlements_mode(text), public.handle_new_user() from public, anon, authenticated;
grant execute on function public.set_dev_entitlements_mode(text) to service_role;
