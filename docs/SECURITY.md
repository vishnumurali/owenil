# Owenil security

## Principles

1. **The database is the security boundary.** Hiding a button is never authorization. Every rule is enforced by Postgres Row Level Security or inside a `SECURITY DEFINER` function that derives the caller from `auth.uid()`.
2. **Least privilege.**
   - `anon` has no table access.
   - `authenticated` gets `SELECT` through RLS, plus column-level `INSERT`/`UPDATE` only on user-owned, non-financial data.
   - Financial tables can only be changed through validated functions.
3. **The browser holds no secrets.**
   - The frontend uses only the publishable key.
   - The secret (service-role) key and DB password live in `.env.local` (gitignored). Only local scripts and tests use them.
   - They are never prefixed with `VITE_`, so they can't enter a bundle.

## Authorization model

| Data | Who can read | Who can change |
|---|---|---|
| Profile | You; people you share a group, friendship, invitation, expense or settlement with (`can_see_profile`). `is_tester` is hidden by a column grant | You (name, avatar, currency, time zone only) |
| Group, members, invites | Active members | Admins: settings (RLS + column grants). Roles and members via RPCs: owner ≥ admin ≥ member |
| Group expense (+ payers, splits, items, revisions, comments) | Active group members | Members: create; creator, participants or admins: edit, delete, restore (RPCs) |
| Non-group expense | Only the people who paid or take part | Same people (RPCs); everyone involved must be the actor's friend |
| Settlement | The two parties and group members | Only the payer or payee can record; parties, the creator or group admins can reverse |
| Ledger | Parties and group members | Nobody directly (append-only trigger); written only by functions |
| Notifications, preferences, budgets, rates, presets, filters | Owner only | Owner. Budgets, rates, presets and saved filters require an active Plus entitlement at insert (RLS) |
| Entitlements | Owner (read-only) | Server only. `dev_set_plan` is allowed only when `app_settings.dev_entitlements_mode` permits it |
| Receipts (Storage) | Owner, plus viewers of the linked expense | Owner uploads only into `receipts/<own uid>/…` and needs Plus. The bucket is private; images are served via 5-minute signed URLs |
| `app_settings`, `idempotency_records`, `rate_limit_events` | Nobody (no grants) | Server only |

### Group roles
- **Owner:** everything. Transfers ownership; deletes the group (only when settled).
- **Admin:**
  - edit settings, archive or unarchive
  - promote members to admin, remove members
  - create admin invites, edit any group expense
- **Member:**
  - add expenses, and edit the ones they created or take part in
  - invite people as members
  - leave the group (only with a zero balance)

### Function privileges
PostgreSQL grants `EXECUTE` to `PUBLIC` by default, and Supabase adds grants for `anon` and `authenticated`. Migration `…05_function_privileges.sql` revokes everything and allow-lists only the client RPCs and the predicates the RLS policies use. Internal helpers would allow impersonation if exposed, so the tests assert that clients can't call them. Examples: `_create_expense_core(payload, actor)`, `_apply_expense_ledger`, `_make_friends`, `generate_due_recurring_expenses`. **If you add a function, update this allow-list.**

## Validation

Client-side Zod and core-engine checks are for user experience only. The database re-validates every financial request:
- amounts are positive integers within limits, and the currency is supported
- the date is in range
- payers are unique, positive and sum to the total
- splits are unique, non-negative, sum to the total, and match exactly the included participants
- method consistency:
  - equal and proportional splits are within one minor unit of the exact share
  - exact amounts match the inputs
  - percentages sum to 100%
  - itemized lines reconcile with the total
- everyone involved is an active group member (or the actor's friend for non-group expenses)
- categories and receipts belong to the actor

## Abuse protections

- **Idempotency keys** on expense and settlement writes. A retry returns the original result, and a reused key with a different payload is rejected.
- **Optimistic concurrency** on expense edits (`version`).
- **Rate limits** inside functions:
  - 600 expense writes/hour
  - 200 settlements/hour
  - 60 invitations/hour
  - 30 groups/hour
  - 120 comments/hour (RLS)
  - Supabase Auth applies its own sign-up and sign-in limits.
- **Invitations:**
  - tokens are 244-bit random values; only their SHA-256 is stored
  - links expire (7 days for groups, 14 for friends) and group links have a use limit
  - links can be revoked
  - email invites never reveal whether an account exists
- **UPI IDs** live in their own table (`payment_handles`), not on the profile, because they often contain a phone number. Only the owner can read the table. Others get a UPI ID through `get_upi_id()`, which answers only for current friends and active co-members of a group: not for pending invitees, former members, ex-friends or strangers. Writes go through `set_upi_id()`, which validates and normalises the ID. Account deletion removes it, and the data export includes it.
- **CSV exports** neutralise spreadsheet formula injection.
- **Browser protections** (GitHub Pages can't set response headers):
  - a strict CSP in a `<meta>` tag (`script-src 'self'`; connections only to Supabase)
  - framing is refused by a script that runs before the app, since `frame-ancestors` doesn't work in a meta tag
  - a strict referrer policy; HTTPS is enforced by GitHub Pages

## Testing authorization

- `tests/sql/authorization.test.ts` (offline, PGlite with the real migrations) covers several behaviours:
  - outsiders see nothing in 16 tables
  - outsiders can't call balance functions, write financial tables, manage members, reverse others' settlements, grant themselves premium or read server config
  - anonymous users are denied
  - internal functions can't be invoked
  - role rules, invitation hashing and expiry, private storage, and account-deletion rules
- `tests/db/hosted.test.ts` repeats the critical checks against the real Supabase project through PostgREST, Auth and Storage, using three separate accounts.
- `tests/e2e/app.spec.ts` (step 9) checks in the browser that another user can't open a group or expense by URL.

## Production checklist

- [ ] `npm run db:tester -- --mode off` (disables the development Plus switch for everyone)
- [ ] Build with `VITE_ENABLE_DEV_TOOLS=false`
- [ ] Supabase → Authentication:
  - email confirmations on
  - custom SMTP configured (see Supabase setup)
  - Site URL and redirect URLs set to the production origin only
- [ ] Supabase → Auth → enable leaked-password protection and a minimum password length of 8 or more
- [ ] Run `npm run db:verify` and `npm run test:db`
- [ ] Rotate the secret key if it was ever shared outside `.env.local`
