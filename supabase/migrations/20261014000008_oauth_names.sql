-- =============================================================================
-- Owenil — profile names for Google (OAuth) sign-ups
--
-- Email sign-up sends `display_name`; Google sends `full_name` / `name`. Use
-- whichever is present, then fall back to the email's local part. The avatar
-- picture is deliberately not copied: Owenil uses initials and a colour, and
-- loading third-party images would widen the Content Security Policy.
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'name', '')), ''));
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

revoke execute on function public.handle_new_user() from public, anon, authenticated;
