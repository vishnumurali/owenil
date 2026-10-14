-- =============================================================================
-- Owenil — paying for one expense, and paying someone everything at once
--
-- 1. settlements.expense_id (optional): a repayment made for a specific
--    expense, so the app can mark that expense "Paid". It must be in the same
--    group (or both outside groups); the payer must take part in the expense
--    and the payee must be someone who paid for it.
-- 2. record_settlements(): several repayments in one all-or-nothing call. Used
--    when one UPI payment covers everything you owe a person across groups.
-- Balances still come only from the ledger; expense_id is an annotation.
-- =============================================================================

alter table public.settlements add column if not exists expense_id uuid references public.expenses(id) on delete set null;
create index if not exists settlements_expense_idx on public.settlements (expense_id) where expense_id is not null;

create or replace function public._record_settlement_core(p jsonb, p_actor uuid, p_is_demo boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_group uuid := nullif(p ->> 'group_id', '')::uuid;
  v_payer uuid := (p ->> 'payer_id')::uuid;
  v_payee uuid := (p ->> 'payee_id')::uuid;
  v_amount bigint := public._jint(p, 'amount_minor', 'Amount');
  v_currency text := p ->> 'currency';
  v_expense uuid := nullif(p ->> 'expense_id', '')::uuid;
  v_e public.expenses;
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

  if v_expense is not null then
    select * into v_e from public.expenses where id = v_expense and deleted_at is null;
    if v_e.id is null or v_e.group_id is distinct from v_group or v_e.currency <> v_currency then
      perform public._err('INVALID_EXPENSE', 'That expense isn’t part of this balance.');
    end if;
    if not exists (select 1 from public.expense_participants x where x.expense_id = v_expense and x.user_id = v_payer and x.included)
       or not exists (select 1 from public.expense_payers x where x.expense_id = v_expense and x.user_id = v_payee) then
      perform public._err('INVALID_EXPENSE', 'Only someone sharing this expense can pay back a person who paid for it.');
    end if;
  end if;

  insert into public.settlements (group_id, payer_id, payee_id, amount_minor, currency, settled_on, method, note, created_by, is_demo, expense_id)
  values (v_group, v_payer, v_payee, v_amount, v_currency, v_date, v_method::public.settlement_method, nullif(trim(coalesce(p ->> 'note', '')), ''), p_actor, p_is_demo, v_expense)
  returning id into v_id;

  -- Payer handed money to payee → payee now "owes" payer, cancelling the debt.
  insert into public.ledger_entries (group_id, currency, debtor_id, creditor_id, amount_minor, source_type, source_id, created_by)
  values (v_group, v_currency, v_payee, v_payer, v_amount, 'settlement', v_id, p_actor);

  perform public._log_activity(v_group, p_actor, 'settlement_recorded', 'settlement', v_id,
    jsonb_build_object('payer_id', v_payer, 'payee_id', v_payee, 'amount_minor', v_amount, 'currency', v_currency, 'expense_id', v_expense),
    case when v_group is null then array[v_payer, v_payee] else '{}' end);
  perform public._notify(case when p_actor = v_payer then v_payee else v_payer end, 'settlement_recorded',
    public._display_name(p_actor) || ' recorded a repayment',
    public._display_name(v_payer) || ' paid ' || public._display_name(v_payee) || ' ' || public._fmt_amount(v_amount, v_currency)
      || case when v_expense is not null then ' for “' || v_e.description || '”' else '' end
      || '. Recorded in Owenil only — no money was moved by the app.',
    case when v_expense is not null then '/expenses/' || v_expense else '/settlements' end, jsonb_build_object('settlement_id', v_id));
  return v_id;
end $$;

-- Several repayments, all or nothing (one UPI payment covering many balances).
create or replace function public.record_settlements(p_payloads jsonb, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._uid();
  v_replay jsonb;
  v_ids uuid[] := '{}';
  v_p jsonb;
  v_result jsonb;
begin
  if jsonb_typeof(p_payloads) is distinct from 'array' or jsonb_array_length(p_payloads) not between 1 and 50 then
    perform public._err('INVALID_PAYLOAD', 'Send between 1 and 50 repayments.');
  end if;
  v_replay := public._idem_begin(v_uid, p_idempotency_key, 'record_settlements', p_payloads);
  if v_replay is not null then return v_replay; end if;
  perform public._rate_limit(v_uid, 'settlement_write', 200, interval '1 hour');
  for v_p in select value from jsonb_array_elements(p_payloads) loop
    v_ids := v_ids || public._record_settlement_core(v_p, v_uid);
  end loop;
  v_result := jsonb_build_object('settlement_ids', to_jsonb(v_ids));
  perform public._idem_finish(v_uid, p_idempotency_key, v_result);
  return v_result;
end $$;

revoke execute on function public.record_settlements(jsonb, text) from public, anon;
grant execute on function public.record_settlements(jsonb, text) to authenticated, service_role;
