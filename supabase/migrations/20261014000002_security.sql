-- =============================================================================
-- Owenil — authorization helpers, Row Level Security and grants
--
-- Principles
--  * RLS is enabled on EVERY table in the public schema.
--  * Clients (role "authenticated") get SELECT through RLS policies; writes to
--    financial tables are only possible through SECURITY DEFINER functions that
--    validate the request and keep the ledger consistent.
--  * The "anon" role has no table access at all.
--  * Column-level grants limit what a user may change on rows they own.
-- =============================================================================

-- ---------- Helper predicates (used by policies; SECURITY DEFINER to avoid
-- recursive RLS evaluation, STABLE so they're cached within a statement) -----

create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.user_id = p_user_id and m.status = 'active'
  );
$$;

create or replace function public.group_role_of(p_group_id uuid, p_user_id uuid default auth.uid())
returns public.group_role language sql stable security definer set search_path = public as $$
  select m.role from public.group_members m
  where m.group_id = p_group_id and m.user_id = p_user_id and m.status = 'active';
$$;

create or replace function public.is_group_admin(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.group_role_of(p_group_id, p_user_id) in ('owner', 'admin'), false);
$$;

create or replace function public.are_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(p_a, p_b) and f.user_b = greatest(p_a, p_b) and f.removed_at is null
  );
$$;

create or replace function public.is_expense_party(p_expense_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.expense_participants p where p.expense_id = p_expense_id and p.user_id = p_user_id)
      or exists (select 1 from public.expense_payers p where p.expense_id = p_expense_id and p.user_id = p_user_id);
$$;

-- Group expenses are visible to active group members; private (non-group)
-- expenses only to the people who paid or take part.
create or replace function public.can_view_expense(p_expense_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.expenses e
    where e.id = p_expense_id
      and (
        (e.group_id is not null and public.is_group_member(e.group_id, p_user_id))
        or (e.group_id is null and public.is_expense_party(e.id, p_user_id))
      )
  );
$$;

create or replace function public.can_view_settlement(p_settlement_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.settlements s
    where s.id = p_settlement_id
      and (s.payer_id = p_user_id or s.payee_id = p_user_id
           or (s.group_id is not null and public.is_group_member(s.group_id, p_user_id)))
  );
$$;

-- You can see someone's profile if you share a group, a friendship (current or
-- past), a pending invitation, an expense or a settlement with them.
create or replace function public.can_see_profile(p_target uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select p_target = p_user_id
    or exists (select 1 from public.group_members a join public.group_members b on b.group_id = a.group_id
               where a.user_id = p_user_id and a.status = 'active' and b.user_id = p_target)
    or exists (select 1 from public.friendships f
               where f.user_a = least(p_target, p_user_id) and f.user_b = greatest(p_target, p_user_id))
    or exists (select 1 from public.friendship_invitations i
               where i.status = 'pending' and ((i.inviter_id = p_user_id and i.invitee_id = p_target)
                                            or (i.inviter_id = p_target and i.invitee_id = p_user_id)))
    or exists (select 1 from public.expense_participants x join public.expense_participants y on y.expense_id = x.expense_id
               where x.user_id = p_user_id and y.user_id = p_target)
    or exists (select 1 from public.expense_payers x join public.expense_participants y on y.expense_id = x.expense_id
               where (x.user_id = p_user_id and y.user_id = p_target) or (x.user_id = p_target and y.user_id = p_user_id))
    or exists (select 1 from public.settlements s
               where (s.payer_id = p_user_id and s.payee_id = p_target) or (s.payer_id = p_target and s.payee_id = p_user_id));
$$;

create or replace function public.is_premium(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscription_entitlements s
    where s.user_id = p_user_id and s.plan = 'plus' and s.status = 'active'
      and (s.current_period_end is null or s.current_period_end > now())
  );
$$;

create or replace function public.can_view_receipt(p_receipt_id uuid, p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.receipt_metadata r
    where r.id = p_receipt_id
      and (r.owner_id = p_user_id or (r.expense_id is not null and public.can_view_expense(r.expense_id, p_user_id)))
  );
$$;

-- ---------- Enable RLS everywhere --------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------- Grants: start from nothing, then add the minimum -----------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Read access (rows further limited by RLS)
grant select on
  public.currencies, public.profiles, public.user_preferences, public.friendships,
  public.friendship_invitations, public.groups, public.group_members, public.group_invitations,
  public.categories, public.receipt_metadata, public.recurring_expense_templates,
  public.recurring_expense_occurrences, public.expenses, public.expense_payers,
  public.expense_participants, public.expense_splits, public.expense_items,
  public.expense_item_assignments, public.expense_revisions, public.settlements,
  public.ledger_entries, public.comments, public.activity_events, public.notifications,
  public.budgets, public.exchange_rate_snapshots, public.split_templates, public.saved_filters,
  public.subscription_entitlements, public.subscription_events
to authenticated;

-- Narrow, column-level write access for non-financial, user-owned data
grant update (display_name, avatar_url, avatar_color, default_currency, timezone, onboarded_at) on public.profiles to authenticated;
grant update (theme, locale, report_currency, week_starts_on, notify_expenses, notify_settlements, notify_comments,
              notify_budget_alerts, notify_recurring, discoverable_by_email) on public.user_preferences to authenticated;
grant update (name, description, group_type, emoji, color, default_currency, simplify_debts, default_split) on public.groups to authenticated;
grant insert (slug, name, icon, color, owner_id) on public.categories to authenticated;
grant update (name, icon, color) on public.categories to authenticated;
grant delete on public.categories to authenticated;
grant insert (id, owner_id, storage_path, mime_type, size_bytes, merchant, receipt_date, currency, subtotal_minor, tax_minor, tip_minor, total_minor)
  on public.receipt_metadata to authenticated;
grant update (merchant, receipt_date, currency, subtotal_minor, tax_minor, tip_minor, total_minor) on public.receipt_metadata to authenticated;
grant delete on public.receipt_metadata to authenticated;
grant insert (expense_id, settlement_id, author_id, body) on public.comments to authenticated;
grant update (deleted_at) on public.comments to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;
grant insert (user_id, name, category_id, group_id, amount_minor, currency, period, alert_threshold_pct) on public.budgets to authenticated;
grant update (name, category_id, group_id, amount_minor, currency, period, alert_threshold_pct) on public.budgets to authenticated;
grant delete on public.budgets to authenticated;
grant insert (user_id, base_currency, quote_currency, rate, as_of, note) on public.exchange_rate_snapshots to authenticated;
grant delete on public.exchange_rate_snapshots to authenticated;
grant insert (owner_id, group_id, name, split_method, participants) on public.split_templates to authenticated;
grant delete on public.split_templates to authenticated;
grant insert (user_id, name, filters) on public.saved_filters to authenticated;
grant delete on public.saved_filters to authenticated;

-- Helper predicates are needed by policies evaluated as "authenticated"
grant execute on function
  public.is_group_member(uuid, uuid), public.group_role_of(uuid, uuid), public.is_group_admin(uuid, uuid),
  public.are_friends(uuid, uuid), public.is_expense_party(uuid, uuid), public.can_view_expense(uuid, uuid),
  public.can_view_settlement(uuid, uuid), public.can_see_profile(uuid, uuid), public.is_premium(uuid),
  public.can_view_receipt(uuid, uuid)
to authenticated;

-- ---------- Policies ---------------------------------------------------------
create policy currencies_read on public.currencies for select to authenticated using (true);

create policy profiles_read on public.profiles for select to authenticated
  using (public.can_see_profile(id, (select auth.uid())));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and deleted_at is null) with check (id = (select auth.uid()));

create policy prefs_read_own on public.user_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy prefs_update_own on public.user_preferences for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy friendships_read on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

create policy friend_invites_read on public.friendship_invitations for select to authenticated
  using (inviter_id = (select auth.uid()) or invitee_id = (select auth.uid()));

create policy groups_read on public.groups for select to authenticated
  using (deleted_at is null and public.is_group_member(id, (select auth.uid())));
create policy groups_update_admin on public.groups for update to authenticated
  using (deleted_at is null and public.is_group_admin(id, (select auth.uid())))
  with check (public.is_group_admin(id, (select auth.uid())));

create policy group_members_read on public.group_members for select to authenticated
  using (public.is_group_member(group_id, (select auth.uid())));

create policy group_invites_read on public.group_invitations for select to authenticated
  using (public.is_group_member(group_id, (select auth.uid())));

create policy categories_read on public.categories for select to authenticated
  using (is_system or owner_id = (select auth.uid())
         or exists (select 1 from public.expenses e where e.category_id = categories.id and public.can_view_expense(e.id, (select auth.uid()))));
create policy categories_insert_own on public.categories for insert to authenticated
  with check (owner_id = (select auth.uid()) and not is_system
              and (select count(*) from public.categories c where c.owner_id = (select auth.uid())) < 50);
create policy categories_update_own on public.categories for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy categories_delete_own on public.categories for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy receipts_read on public.receipt_metadata for select to authenticated
  using (public.can_view_receipt(id, (select auth.uid())));
create policy receipts_insert_own on public.receipt_metadata for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_premium((select auth.uid()))
              and (storage_path is null or storage_path like (select auth.uid())::text || '/%'));
create policy receipts_update_own on public.receipt_metadata for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy receipts_delete_own on public.receipt_metadata for delete to authenticated
  using (owner_id = (select auth.uid()) and expense_id is null);

create policy recurring_read on public.recurring_expense_templates for select to authenticated
  using (created_by = (select auth.uid())
         or (group_id is not null and public.is_group_member(group_id, (select auth.uid())))
         or (group_id is null and exists (select 1 from jsonb_array_elements(payload -> 'participants') p
                                          where (p ->> 'user_id')::uuid = (select auth.uid()))));
create policy recurring_occ_read on public.recurring_expense_occurrences for select to authenticated
  using (exists (select 1 from public.recurring_expense_templates t where t.id = template_id));

create policy expenses_read on public.expenses for select to authenticated
  using (public.can_view_expense(id, (select auth.uid())));
create policy expense_payers_read on public.expense_payers for select to authenticated
  using (public.can_view_expense(expense_id, (select auth.uid())));
create policy expense_participants_read on public.expense_participants for select to authenticated
  using (public.can_view_expense(expense_id, (select auth.uid())));
create policy expense_splits_read on public.expense_splits for select to authenticated
  using (public.can_view_expense(expense_id, (select auth.uid())));
create policy expense_items_read on public.expense_items for select to authenticated
  using (public.can_view_expense(expense_id, (select auth.uid())));
create policy expense_item_assignments_read on public.expense_item_assignments for select to authenticated
  using (exists (select 1 from public.expense_items i where i.id = item_id and public.can_view_expense(i.expense_id, (select auth.uid()))));
create policy expense_revisions_read on public.expense_revisions for select to authenticated
  using (public.can_view_expense(expense_id, (select auth.uid())));

create policy settlements_read on public.settlements for select to authenticated
  using (public.can_view_settlement(id, (select auth.uid())));

create policy ledger_read on public.ledger_entries for select to authenticated
  using (debtor_id = (select auth.uid()) or creditor_id = (select auth.uid())
         or (group_id is not null and public.is_group_member(group_id, (select auth.uid()))));

create policy comments_read on public.comments for select to authenticated
  using ((expense_id is not null and public.can_view_expense(expense_id, (select auth.uid())))
      or (settlement_id is not null and public.can_view_settlement(settlement_id, (select auth.uid()))));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid())
              and ((expense_id is not null and public.can_view_expense(expense_id, (select auth.uid())))
                or (settlement_id is not null and public.can_view_settlement(settlement_id, (select auth.uid()))))
              and (select count(*) from public.comments c where c.author_id = (select auth.uid()) and c.created_at > now() - interval '1 hour') < 120);
create policy comments_soft_delete_own on public.comments for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));

create policy activity_read on public.activity_events for select to authenticated
  using ((group_id is not null and public.is_group_member(group_id, (select auth.uid())))
      or (select auth.uid()) = any (visible_to));

create policy notifications_read_own on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

-- Owenil Plus features: creation requires an active server-side entitlement.
create policy budgets_read_own on public.budgets for select to authenticated using (user_id = (select auth.uid()));
create policy budgets_insert_plus on public.budgets for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_premium((select auth.uid()))
              and (group_id is null or public.is_group_member(group_id, (select auth.uid()))));
create policy budgets_update_own on public.budgets for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_premium((select auth.uid())));
create policy budgets_delete_own on public.budgets for delete to authenticated using (user_id = (select auth.uid()));

create policy fx_read_own on public.exchange_rate_snapshots for select to authenticated using (user_id = (select auth.uid()));
create policy fx_insert_plus on public.exchange_rate_snapshots for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_premium((select auth.uid())));
create policy fx_delete_own on public.exchange_rate_snapshots for delete to authenticated using (user_id = (select auth.uid()));

create policy split_templates_read on public.split_templates for select to authenticated
  using (owner_id = (select auth.uid()));
create policy split_templates_insert_plus on public.split_templates for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_premium((select auth.uid()))
              and (group_id is null or public.is_group_member(group_id, (select auth.uid()))));
create policy split_templates_delete_own on public.split_templates for delete to authenticated using (owner_id = (select auth.uid()));

create policy saved_filters_read on public.saved_filters for select to authenticated using (user_id = (select auth.uid()));
create policy saved_filters_insert_plus on public.saved_filters for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_premium((select auth.uid())));
create policy saved_filters_delete_own on public.saved_filters for delete to authenticated using (user_id = (select auth.uid()));

-- Entitlements: read-only for the owner. Only server-side code can change them.
create policy entitlements_read_own on public.subscription_entitlements for select to authenticated using (user_id = (select auth.uid()));
create policy subscription_events_read_own on public.subscription_events for select to authenticated using (user_id = (select auth.uid()));

-- app_settings, idempotency_records, rate_limit_events: RLS enabled, no
-- policies and no grants → inaccessible to clients.
