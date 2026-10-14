-- =============================================================================
-- Owenil — rename from the project's earlier working name ("Splitora").
--
-- Databases created before the rename still carry the old name in user-visible
-- function messages, stored notifications and pg_cron job names. This rewrites
-- all of them. On a database built from the current migrations nothing matches,
-- so it is a no-op there. Re-running it is safe.
-- =============================================================================

-- 1. Functions: re-create each affected function from its own definition with
--    the new name. CREATE OR REPLACE keeps owners, grants and SECURITY DEFINER.
do $$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ilike '%splitora%'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := regexp_replace(v_def, '\ma Splitora', 'an Owenil', 'g');
    v_def := replace(replace(v_def, 'Splitora', 'Owenil'), 'splitora', 'owenil');
    execute v_def;
  end loop;
end
$$;

-- 2. Notifications already delivered with the old name.
update public.notifications
   set body = replace(regexp_replace(body, '\ma Splitora', 'an Owenil', 'g'), 'Splitora', 'Owenil')
 where body like '%Splitora%';
update public.notifications
   set title = replace(regexp_replace(title, '\ma Splitora', 'an Owenil', 'g'), 'Splitora', 'Owenil')
 where title like '%Splitora%';

-- 3. Scheduled jobs (only where pg_cron is installed).
do $$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname in ('splitora-recurring', 'splitora-cleanup');
  if not exists (select 1 from cron.job where jobname = 'owenil-recurring') then
    perform cron.schedule('owenil-recurring', '5 * * * *', 'select public.generate_due_recurring_expenses()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'owenil-cleanup') then
    perform cron.schedule('owenil-cleanup', '17 3 * * *', 'select public.cleanup_ephemeral_records()');
  end if;
end
$$;
