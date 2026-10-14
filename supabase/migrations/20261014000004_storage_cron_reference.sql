-- =============================================================================
-- Owenil — reference data, private receipt storage, scheduled jobs
-- =============================================================================

-- ---------- Currencies (mirrors packages/core/src/currency.ts) ---------------
insert into public.currencies (code, name, symbol, minor_units) values
  ('INR', 'Indian Rupee', '₹', 2), ('USD', 'US Dollar', '$', 2), ('EUR', 'Euro', '€', 2),
  ('GBP', 'British Pound', '£', 2), ('AED', 'UAE Dirham', 'د.إ', 2), ('AUD', 'Australian Dollar', 'A$', 2),
  ('CAD', 'Canadian Dollar', 'C$', 2), ('SGD', 'Singapore Dollar', 'S$', 2), ('CHF', 'Swiss Franc', 'CHF', 2),
  ('CNY', 'Chinese Yuan', '¥', 2), ('HKD', 'Hong Kong Dollar', 'HK$', 2), ('NZD', 'New Zealand Dollar', 'NZ$', 2),
  ('SEK', 'Swedish Krona', 'kr', 2), ('ZAR', 'South African Rand', 'R', 2), ('THB', 'Thai Baht', '฿', 2),
  ('MYR', 'Malaysian Ringgit', 'RM', 2), ('LKR', 'Sri Lankan Rupee', 'Rs', 2), ('NPR', 'Nepalese Rupee', 'रू', 2),
  ('SAR', 'Saudi Riyal', '﷼', 2), ('JPY', 'Japanese Yen', '¥', 0), ('KRW', 'South Korean Won', '₩', 0),
  ('IDR', 'Indonesian Rupiah', 'Rp', 2), ('VND', 'Vietnamese Dong', '₫', 0), ('KWD', 'Kuwaiti Dinar', 'KD', 3),
  ('BHD', 'Bahraini Dinar', 'BD', 3), ('OMR', 'Omani Rial', 'OMR', 3)
on conflict (code) do update set name = excluded.name, symbol = excluded.symbol, minor_units = excluded.minor_units;

-- ---------- Built-in categories ----------------------------------------------
insert into public.categories (slug, name, icon, color, is_system) values
  ('food', 'Food & dining', 'utensils', '#f97316', true),
  ('groceries', 'Groceries', 'shopping-basket', '#84cc16', true),
  ('rent', 'Rent', 'home', '#6366f1', true),
  ('utilities', 'Utilities', 'plug-zap', '#eab308', true),
  ('travel', 'Travel', 'plane', '#0ea5e9', true),
  ('transport', 'Transport', 'bus', '#14b8a6', true),
  ('fuel', 'Fuel', 'fuel', '#ef4444', true),
  ('accommodation', 'Accommodation', 'bed-double', '#8b5cf6', true),
  ('shopping', 'Shopping', 'shopping-bag', '#ec4899', true),
  ('entertainment', 'Entertainment', 'clapperboard', '#f43f5e', true),
  ('healthcare', 'Healthcare', 'heart-pulse', '#10b981', true),
  ('education', 'Education', 'graduation-cap', '#3b82f6', true),
  ('subscriptions', 'Subscriptions', 'repeat', '#a855f7', true),
  ('household', 'Household', 'sofa', '#d97706', true),
  ('business', 'Business', 'briefcase', '#64748b', true),
  ('other', 'Other', 'tag', '#94a3b8', true)
on conflict (slug) where is_system do update set name = excluded.name, icon = excluded.icon, color = excluded.color;

-- ---------- Server configuration ---------------------------------------------
-- 'testers': only profiles flagged is_tester (set via `npm run db:tester`) may
-- use the development premium switch. Use 'off' in production.
insert into public.app_settings (key, value) values ('dev_entitlements_mode', '"testers"')
on conflict (key) do nothing;

-- ---------- Private receipt storage ------------------------------------------
-- Files live at receipts/<user-id>/<uuid>.<ext>. The bucket is NOT public;
-- images are served through short-lived signed URLs after RLS checks.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts: owners upload into their folder (Plus)" on storage.objects;
create policy "receipts: owners upload into their folder (Plus)" on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
              and (storage.foldername(name))[1] = (select auth.uid())::text
              and public.is_premium((select auth.uid())));

drop policy if exists "receipts: owner or expense viewers can read" on storage.objects;
create policy "receipts: owner or expense viewers can read" on storage.objects for select to authenticated
  using (bucket_id = 'receipts'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or exists (select 1 from public.receipt_metadata r
                          where r.storage_path = storage.objects.name and r.expense_id is not null
                            and public.can_view_expense(r.expense_id, (select auth.uid())))));

drop policy if exists "receipts: owners delete their files" on storage.objects;
create policy "receipts: owners delete their files" on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------- Housekeeping ------------------------------------------------------
create or replace function public.cleanup_ephemeral_records()
returns void language sql security definer set search_path = public as $$
  delete from public.idempotency_records where created_at < now() - interval '7 days';
  delete from public.rate_limit_events where created_at < now() - interval '2 days';
  update public.friendship_invitations set status = 'expired' where status = 'pending' and expires_at < now();
$$;

-- ---------- Scheduling (pg_cron; free on Supabase) ----------------------------
-- Recurring expenses are generated server-side every hour (each template uses
-- its creator's time zone), so nothing depends on a browser being open.
do $outer$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron not available (%). Enable it in Dashboard → Database → Extensions, then re-run this block.', sqlerrm;
    return;
  end;
  perform cron.unschedule(jobid) from cron.job where jobname in ('owenil-recurring', 'owenil-cleanup');
  perform cron.schedule('owenil-recurring', '5 * * * *', 'select public.generate_due_recurring_expenses()');
  perform cron.schedule('owenil-cleanup', '17 3 * * *', 'select public.cleanup_ephemeral_records()');
end
$outer$;
