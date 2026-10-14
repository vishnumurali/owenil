-- =============================================================================
-- Owenil — fix "infinite recursion detected in policy for relation …"
--
-- Two insert policies capped usage by counting rows of their own table inside
-- the policy (comments: 120 per hour; custom categories: 50 per user). Postgres
-- rejects a policy that reads its own table, so posting a comment or adding a
-- custom category failed. Count through SECURITY DEFINER helpers instead (they
-- only ever look at the caller's own rows), like the other policy predicates.
-- =============================================================================
create or replace function public.comment_rate_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from public.comments c
           where c.author_id = auth.uid() and c.created_at > now() - interval '1 hour') < 120;
$$;

create or replace function public.category_quota_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select (select count(*) from public.categories c where c.owner_id = auth.uid()) < 50;
$$;

revoke execute on function public.comment_rate_ok(), public.category_quota_ok() from public, anon;
grant execute on function public.comment_rate_ok(), public.category_quota_ok() to authenticated, service_role;

drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid())
              and ((expense_id is not null and public.can_view_expense(expense_id, (select auth.uid())))
                or (settlement_id is not null and public.can_view_settlement(settlement_id, (select auth.uid()))))
              and public.comment_rate_ok());

drop policy if exists categories_insert_own on public.categories;
create policy categories_insert_own on public.categories for insert to authenticated
  with check (owner_id = (select auth.uid()) and not is_system and public.category_quota_ok());
