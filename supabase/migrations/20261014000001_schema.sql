-- =============================================================================
-- Owenil — core schema
-- Money is stored as BIGINT minor units (paise/cents) + ISO-4217 currency.
-- Balances are never stored; they are derived from the append-only
-- ledger_entries table, which only SECURITY DEFINER functions can write.
-- =============================================================================

-- ---------- Enumerated types -------------------------------------------------
create type public.group_role as enum ('owner', 'admin', 'member');
create type public.member_status as enum ('active', 'left', 'removed');
create type public.split_method as enum ('equal', 'exact', 'percentage', 'shares', 'adjustment', 'itemized');
create type public.item_kind as enum ('item', 'tax', 'tip', 'discount');
create type public.invitation_status as enum ('pending', 'accepted', 'declined', 'revoked', 'expired');
create type public.settlement_method as enum ('cash', 'upi', 'bank_transfer', 'card', 'other');
create type public.recurrence_frequency as enum ('weekly', 'monthly', 'quarterly', 'yearly');
create type public.template_status as enum ('active', 'paused', 'cancelled');
create type public.budget_period as enum ('monthly', 'yearly');
create type public.plan_tier as enum ('free', 'plus');
create type public.ledger_source as enum ('expense', 'settlement');
create type public.revision_change as enum ('created', 'updated', 'deleted', 'restored');

-- ---------- Generic updated_at trigger --------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Reference data ---------------------------------------------------
create table public.currencies (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  symbol text not null,
  minor_units smallint not null check (minor_units in (0, 2, 3))
);

-- Server-side configuration. Not readable or writable by clients.
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- Profiles & preferences -------------------------------------------
-- profiles.id equals auth.users.id. There is intentionally no FK to auth.users:
-- when an account is deleted the profile is anonymised (not removed) so that
-- other people's financial history stays intact and auditable.
create table public.profiles (
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  avatar_color text not null default '#14b8a6' check (avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  default_currency char(3) not null default 'INR' references public.currencies(code),
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 64),
  onboarded_at timestamptz,
  is_demo boolean not null default false,
  is_tester boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  locale text not null default 'en-IN' check (char_length(locale) <= 16),
  report_currency char(3) references public.currencies(code),
  week_starts_on smallint not null default 1 check (week_starts_on in (0, 1, 6)),
  notify_expenses boolean not null default true,
  notify_settlements boolean not null default true,
  notify_comments boolean not null default true,
  notify_budget_alerts boolean not null default true,
  notify_recurring boolean not null default true,
  discoverable_by_email boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences for each row execute function public.set_updated_at();

-- ---------- Friends ----------------------------------------------------------
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id),
  user_b uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  check (user_a < user_b),           -- canonical ordering prevents (a,b)/(b,a) duplicates
  unique (user_a, user_b)
);
create index friendships_user_b_idx on public.friendships (user_b);

create table public.friendship_invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references public.profiles(id),
  invitee_email text check (invitee_email is null or (invitee_email = lower(invitee_email) and char_length(invitee_email) <= 254)),
  invitee_id uuid references public.profiles(id),
  token_hash text not null unique,   -- sha256 of the secret link token; the token itself is never stored
  status public.invitation_status not null default 'pending',
  expires_at timestamptz not null default now() + interval '14 days',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (invitee_id is null or invitee_id <> inviter_id)
);
create unique index friendship_invitations_pending_email_uq
  on public.friendship_invitations (inviter_id, invitee_email) where status = 'pending' and invitee_email is not null;
create index friendship_invitations_invitee_idx on public.friendship_invitations (invitee_id) where status = 'pending';

-- ---------- Groups -----------------------------------------------------------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  description text not null default '' check (char_length(description) <= 280),
  group_type text not null default 'other' check (group_type in ('travel', 'home', 'couple', 'family', 'outing', 'other')),
  emoji text not null default '✨' check (char_length(emoji) <= 8),
  color text not null default '#14b8a6' check (color ~ '^#[0-9a-fA-F]{6}$'),
  default_currency char(3) not null default 'INR' references public.currencies(code),
  simplify_debts boolean not null default true,
  default_split jsonb,               -- saved group default: {"method": "...", "participants": [{"user_id","value"}]}
  created_by uuid not null references public.profiles(id),
  archived_at timestamptz,
  deleted_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger groups_updated_at before update on public.groups for each row execute function public.set_updated_at();

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  role public.group_role not null default 'member',
  status public.member_status not null default 'active',
  added_by uuid references public.profiles(id),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  unique (group_id, user_id)
);
create index group_members_user_idx on public.group_members (user_id) where status = 'active';
create unique index group_members_one_owner_uq on public.group_members (group_id) where role = 'owner' and status = 'active';

create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  token_hash text not null unique,
  role public.group_role not null default 'member' check (role in ('admin', 'member')),
  max_uses integer not null default 25 check (max_uses between 1 and 500),
  use_count integer not null default 0 check (use_count >= 0),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index group_invitations_group_idx on public.group_invitations (group_id);

-- ---------- Categories -------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 40),
  icon text not null default 'tag' check (char_length(icon) <= 40),
  color text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  owner_id uuid references public.profiles(id) on delete cascade,  -- null = built-in category
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  check ((is_system and owner_id is null) or (not is_system and owner_id is not null))
);
create unique index categories_system_slug_uq on public.categories (slug) where is_system;
create unique index categories_owner_name_uq on public.categories (owner_id, lower(name)) where owner_id is not null;

-- ---------- Receipts (metadata; images live in the private "receipts" bucket) --
create table public.receipt_metadata (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  expense_id uuid,                   -- FK added after expenses table
  storage_path text unique check (storage_path is null or char_length(storage_path) <= 300),
  mime_type text check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  size_bytes integer check (size_bytes is null or size_bytes between 1 and 5242880),
  merchant text check (merchant is null or char_length(merchant) <= 120),
  receipt_date date,
  currency char(3) references public.currencies(code),
  subtotal_minor bigint check (subtotal_minor is null or subtotal_minor >= 0),
  tax_minor bigint check (tax_minor is null or tax_minor >= 0),
  tip_minor bigint check (tip_minor is null or tip_minor >= 0),
  total_minor bigint check (total_minor is null or total_minor >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger receipt_metadata_updated_at before update on public.receipt_metadata for each row execute function public.set_updated_at();

-- ---------- Recurring templates (declared before expenses for FK) -------------
create table public.recurring_expense_templates (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  group_id uuid references public.groups(id),
  description text not null check (char_length(description) between 1 and 140),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  currency char(3) not null references public.currencies(code),
  category_id uuid references public.categories(id),
  frequency public.recurrence_frequency not null,
  start_date date not null,
  end_date date check (end_date is null or end_date >= start_date),
  status public.template_status not null default 'active',
  next_index integer not null default 0 check (next_index >= 0),   -- index n of the next occurrence to generate
  next_occurrence_on date,                                         -- cached for listing / "upcoming"
  payload jsonb not null,            -- validated expense payload (payers, participants, splits, items, notes, tags)
  last_error text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recurring_templates_due_idx on public.recurring_expense_templates (next_occurrence_on) where status = 'active';
create trigger recurring_templates_updated_at before update on public.recurring_expense_templates for each row execute function public.set_updated_at();

-- ---------- Expenses ---------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id),       -- null = private expense between friends
  description text not null check (char_length(description) between 1 and 140),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  currency char(3) not null references public.currencies(code),
  expense_date date not null,
  category_id uuid references public.categories(id),
  notes text check (notes is null or char_length(notes) <= 2000),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  split_method public.split_method not null,
  receipt_id uuid references public.receipt_metadata(id),
  recurring_template_id uuid references public.recurring_expense_templates(id),
  created_by uuid not null references public.profiles(id),
  version integer not null default 1 check (version >= 1),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_group_date_idx on public.expenses (group_id, expense_date desc) where deleted_at is null;
create index expenses_created_by_idx on public.expenses (created_by);
create index expenses_date_idx on public.expenses (expense_date desc);
create index expenses_description_trgm_idx on public.expenses using gin (to_tsvector('simple', description));
create trigger expenses_updated_at before update on public.expenses for each row execute function public.set_updated_at();

alter table public.receipt_metadata
  add constraint receipt_metadata_expense_fk foreign key (expense_id) references public.expenses(id) on delete set null;

-- Who paid, and how much (distinct from who owes).
create table public.expense_payers (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor > 0),
  primary key (expense_id, user_id)
);
create index expense_payers_user_idx on public.expense_payers (user_id);

-- Split inputs: who takes part and the method-specific value
-- (exact: minor units; percentage: 1/100 of a percent; shares: 1/100 of a share; adjustment: minor units).
create table public.expense_participants (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  included boolean not null default true,
  input_value bigint,
  primary key (expense_id, user_id)
);
create index expense_participants_user_idx on public.expense_participants (user_id);

-- Split outputs: what each included participant owes. Σ = expense amount.
create table public.expense_splits (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor >= 0),
  primary key (expense_id, user_id)
);
create index expense_splits_user_idx on public.expense_splits (user_id);

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount_minor bigint not null check (amount_minor >= 0),
  kind public.item_kind not null default 'item',
  position integer not null default 0
);
create index expense_items_expense_idx on public.expense_items (expense_id);

create table public.expense_item_assignments (
  item_id uuid not null references public.expense_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  weight integer not null default 1 check (weight > 0),
  primary key (item_id, user_id)
);

-- Audit history: a full snapshot for every financially significant change.
create table public.expense_revisions (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  version integer not null,
  change_type public.revision_change not null,
  snapshot jsonb not null,
  changed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (expense_id, version, change_type)
);

-- ---------- Settlements ------------------------------------------------------
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id),
  payer_id uuid not null references public.profiles(id),     -- the person who handed over money
  payee_id uuid not null references public.profiles(id),     -- the person who received it
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  currency char(3) not null references public.currencies(code),
  settled_on date not null,
  method public.settlement_method not null default 'cash',
  note text check (note is null or char_length(note) <= 500),
  created_by uuid not null references public.profiles(id),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(id),
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 300),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payer_id <> payee_id)
);
create index settlements_group_idx on public.settlements (group_id, settled_on desc);
create index settlements_payer_idx on public.settlements (payer_id);
create index settlements_payee_idx on public.settlements (payee_id);
create trigger settlements_updated_at before update on public.settlements for each row execute function public.set_updated_at();

-- ---------- The ledger -------------------------------------------------------
-- Append-only. Each row: debtor owes creditor amount_minor (negative rows are
-- reversals). Expense edits insert reversals of the old lines plus new lines in
-- one transaction, so every change is applied exactly once and is auditable.
create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id),
  currency char(3) not null references public.currencies(code),
  debtor_id uuid not null references public.profiles(id),
  creditor_id uuid not null references public.profiles(id),
  amount_minor bigint not null check (amount_minor <> 0),
  source_type public.ledger_source not null,
  source_id uuid not null,
  source_version integer not null default 1,
  reverses_entry_id uuid references public.ledger_entries(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  check (debtor_id <> creditor_id),
  check ((reverses_entry_id is null) = (amount_minor > 0))
);
create unique index ledger_entries_one_reversal_uq on public.ledger_entries (reverses_entry_id) where reverses_entry_id is not null;
create index ledger_entries_source_idx on public.ledger_entries (source_type, source_id);
create index ledger_entries_group_idx on public.ledger_entries (group_id, currency);
create index ledger_entries_debtor_idx on public.ledger_entries (debtor_id, currency);
create index ledger_entries_creditor_idx on public.ledger_entries (creditor_id, currency);

create or replace function public.ledger_entries_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'ledger_entries is append-only' using errcode = 'P0001';
end $$;
create trigger ledger_entries_no_update before update or delete on public.ledger_entries
  for each row execute function public.ledger_entries_immutable();

-- ---------- Recurring occurrences --------------------------------------------
create table public.recurring_expense_occurrences (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.recurring_expense_templates(id) on delete cascade,
  occurrence_index integer not null,
  occurrence_date date not null,
  expense_id uuid references public.expenses(id) on delete set null,
  status text not null check (status in ('created', 'skipped', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  unique (template_id, occurrence_date)          -- prevents duplicate scheduled occurrences
);

-- ---------- Social: comments, activity, notifications ------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid references public.expenses(id) on delete cascade,
  settlement_id uuid references public.settlements(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((expense_id is null) <> (settlement_id is null))
);
create index comments_expense_idx on public.comments (expense_id, created_at);
create index comments_settlement_idx on public.comments (settlement_id, created_at);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  summary jsonb not null default '{}',
  visible_to uuid[] not null default '{}',     -- explicit audience for non-group events
  created_at timestamptz not null default now()
);
create index activity_events_group_idx on public.activity_events (group_id, created_at desc);
create index activity_events_visible_idx on public.activity_events using gin (visible_to);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null check (char_length(title) <= 200),
  body text check (body is null or char_length(body) <= 1000),
  link text check (link is null or char_length(link) <= 300),
  data jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------- Budgets, FX, presets, filters (Owenil Plus) --------------------
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Budget' check (char_length(name) between 1 and 60),
  category_id uuid references public.categories(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 1000000000000),
  currency char(3) not null references public.currencies(code),
  period public.budget_period not null default 'monthly',
  alert_threshold_pct smallint not null default 80 check (alert_threshold_pct between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index budgets_user_idx on public.budgets (user_id);
create trigger budgets_updated_at before update on public.budgets for each row execute function public.set_updated_at();

-- User-recorded exchange rates. Owenil never claims a rate is live.
create table public.exchange_rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  base_currency char(3) not null references public.currencies(code),
  quote_currency char(3) not null references public.currencies(code),
  rate numeric(24, 12) not null check (rate > 0),
  as_of date not null,
  source text not null default 'manual' check (source in ('manual')),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now(),
  check (base_currency <> quote_currency),
  unique (user_id, base_currency, quote_currency, as_of)
);

create table public.split_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  split_method public.split_method not null check (split_method <> 'itemized'),
  participants jsonb not null,       -- [{"user_id": "...", "value": 123}]
  created_at timestamptz not null default now()
);

create table public.saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  filters jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------- Subscriptions (no payment processing in this release) ------------
create table public.subscription_entitlements (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan public.plan_tier not null default 'free',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  source text not null default 'default' check (source in ('default', 'development', 'manual', 'web', 'app_store', 'play_store')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscription_entitlements_updated_at before update on public.subscription_entitlements for each row execute function public.set_updated_at();

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  from_plan public.plan_tier,
  to_plan public.plan_tier,
  source text not null,
  actor_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- ---------- Idempotency & rate limiting ---------------------------------------
create table public.idempotency_records (
  user_id uuid not null,
  key text not null check (char_length(key) between 8 and 100),
  operation text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index idempotency_records_created_idx on public.idempotency_records (created_at);

create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup_idx on public.rate_limit_events (user_id, bucket, created_at desc);
