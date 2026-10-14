-- =============================================================================
-- Owenil — function privileges (single source of truth)
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC, and Supabase adds
-- default grants to anon/authenticated. Internal helpers such as
-- _create_expense_core(payload, actor) must NEVER be callable by clients, or a
-- user could act as someone else. So: revoke everything, then allow-list.
-- Re-run this block after adding functions (keep the allow-list current).
-- =============================================================================
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;

-- Predicates used inside RLS policies (evaluated as the "authenticated" role)
grant execute on function
  public.is_group_member(uuid, uuid), public.group_role_of(uuid, uuid), public.is_group_admin(uuid, uuid),
  public.are_friends(uuid, uuid), public.is_expense_party(uuid, uuid), public.can_view_expense(uuid, uuid),
  public.can_view_settlement(uuid, uuid), public.can_see_profile(uuid, uuid), public.is_premium(uuid),
  public.can_view_receipt(uuid, uuid)
to authenticated;

-- Client-callable RPCs (each one derives the caller from auth.uid())
grant execute on function
  public.get_group_balances(uuid), public.get_balance_overview(),
  public.create_expense(jsonb, text), public.update_expense(uuid, integer, jsonb, text),
  public.delete_expense(uuid, integer), public.restore_expense(uuid),
  public.record_settlement(jsonb, text), public.reverse_settlement(uuid, text),
  public.create_group(text, text, text, text, text, text, boolean, uuid[]), public.add_group_members(uuid, uuid[]),
  public.create_group_invitation(uuid, text, integer, integer), public.revoke_group_invitation(uuid),
  public.preview_invitation(text, text), public.accept_group_invitation(text),
  public.set_group_member_role(uuid, uuid, text), public.remove_group_member(uuid, uuid), public.leave_group(uuid),
  public.set_group_archived(uuid, boolean), public.delete_group(uuid),
  public.create_friend_invitation(text), public.accept_friend_invitation(text), public.respond_friend_invitation(uuid, boolean),
  public.revoke_friend_invitation(uuid), public.remove_friend(uuid),
  public.create_recurring_template(jsonb, text, date, date), public.update_recurring_template(uuid, jsonb, text, date, date),
  public.set_recurring_status(uuid, text), public.run_due_recurring_now(),
  public.get_my_spending(date, date), public.get_dev_tools_status(), public.dev_set_plan(text),
  public.export_my_data(), public.delete_my_account(text), public.get_visible_profiles()
to authenticated;

-- Everything else (names starting with "_", generate_due_recurring_expenses,
-- cleanup_ephemeral_records, trigger functions) is reachable only from inside
-- SECURITY DEFINER functions, pg_cron, or the service role.
grant execute on all functions in schema public to service_role;

-- Column-level read access on profiles: internal flags (is_tester) stay hidden.
revoke select on public.profiles from authenticated;
grant select (id, display_name, avatar_url, avatar_color, default_currency, timezone, onboarded_at, is_demo, deleted_at, created_at, updated_at)
  on public.profiles to authenticated;
