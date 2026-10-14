# Owenil architecture

## Overview

```
Browser (React SPA, /owenil/)
   │  supabase-js with the publishable key + the user's JWT
   ▼
Supabase ─ Auth (email/password, verification, reset)
         ─ PostgREST Data API → Postgres with RLS on every table
               reads: SELECT through RLS policies
               writes: SECURITY DEFINER RPCs (validated, atomic, idempotent)
         ─ Storage: private "receipts" bucket (RLS on storage.objects)
         ─ pg_cron: hourly recurring-expense generator, daily cleanup
GitHub Pages ─ static files at vishnumurali.github.io/owenil/
               404.html SPA fallback, CSP meta tag; built by GitHub Actions
```

There is no custom application server. All authorization runs in the database, so the web app, the future mobile apps and any other client get the same guarantees.

## Packages and layers

| Layer | Location | Responsibility |
|---|---|---|
| Domain | `packages/core` | Pure TypeScript with no I/O. Money, splitting, ledger attribution, simplification, recurrence, analytics, validation, CSV |
| Data | `src/data` | TanStack Query hooks over Supabase, query keys, cache invalidation after financial changes, client-side balance derivation |
| UI kit | `src/components/ui` | Accessible primitives (Radix), tokens, motion helpers, illustrations |
| Features | `src/features/*` | One folder per area (auth, dashboard, groups, friends, expenses, balances, recurring, analytics, budgets, premium, settings, help) |
| Database | `supabase/migrations` | Schema, RLS, business functions, storage and cron, privileges |
| Hosting | `.github/workflows/`, `vite.config.ts` | Build, SPA fallback, CSP meta tag, publish to GitHub Pages |

## Financial model

### Amounts
`bigint` minor units plus an ISO currency code. `currencies.minor_units` defines precision (0, 2 or 3). The client parses user input from strings (`parseMoney`) and never through floating point. Large intermediate products use `BigInt` in TypeScript and `numeric` in SQL.

### Expense = payers + participants + splits
- `expense_payers`: who paid how much (Σ = amount).
- `expense_participants`: who takes part, whether they're included, and the method's input value. Exact uses minor units, percentage uses hundredths of a percent, shares use hundredths of a share, and adjustment uses minor units.
- `expense_splits`: what each included participant owes (Σ = amount).
- `expense_items` and `expense_item_assignments`: itemized receipts.

Payer contributions are kept separate from allocations.

### Splitting engine (`packages/core/src/split.ts`)
- **Largest-remainder rounding.** Remaining units go first to the largest fractional remainders. Ties break by user id, so the result never depends on UI ordering.
- **Methods:**
  - **equal**: weights of 1 each.
  - **exact**: amounts must sum to the total.
  - **percentage**: must sum to exactly 100.00%.
  - **shares**: weights in hundredths.
  - **adjustment**: equal split of (total − Σ adjustments), plus each person's adjustment.
  - **itemized**: items split among their assignees. Tax, tip and discount are spread pro rata to item subtotals, and lines must reconcile with the total.
- **Invariant:** Σ allocations = total, checked on every call. The tests include 3,000 randomized cases.

### Ledger (`ledger_entries`, append-only)
Each row means *debtor owes creditor amount*. A trigger rejects UPDATE and DELETE, even from the table owner.

- **Expense → lines** (`_expense_ledger_lines`): everyone first covers their own share from what they paid. Remaining debts are then matched to remaining credits in user-id order (a north-west corner fill). This uses integers only, is deterministic, and preserves every payer contribution and every share exactly. `attributeExpense` in `packages/core` is the identical algorithm, and a test asserts that the database output matches it.
- **Edit:** `_reverse_source_ledger` inserts negated copies of the expense's unreversed lines. A unique index on `reverses_entry_id` makes each reversal exactly-once. New lines are then written. Everything happens in one transaction guarded by `expenses.version` (optimistic concurrency).
- **Delete:** reversal plus a soft delete. **Restore:** re-applies the current lines.
- **Settlement** "payer paid payee X" writes `payee owes payer X`, cancelling the original debt. A reversal writes the negation.
- **Balances** are sums over the ledger:
  - Group net per member: `_group_nets` (Σ per currency = 0).
  - Caller's pairwise balances: `get_balance_overview`.
  - Nothing is ever cached as a total.

### Debt simplification (`simplify.ts`)
Greedy: the largest debtor pays the largest creditor, with deterministic tie-breaks. This produces at most n−1 transfers and preserves every net position. It runs client-side from group nets, per currency. If a group turns simplification off, the UI shows exact pairwise balances from the ledger instead.

### Idempotency and concurrency
`create_expense`, `update_expense` and `record_settlement` accept a client key. `_idem_begin` inserts a placeholder row with `ON CONFLICT DO NOTHING`; a concurrent duplicate waits, then gets the stored response. Reusing a key for a different payload is rejected. Expense edits also check `version`.

### Recurring expenses
`recurring_expense_templates` stores a validated payload and the schedule. Occurrence *n* is computed from the start date, which avoids month-end drift; `occurrenceDate` and `_occurrence_date` match. The hourly `pg_cron` job (`generate_due_recurring_expenses`) creates each due occurrence. `unique(template_id, occurrence_date)` makes it exactly-once, even if two runs overlap or someone presses "Run due now". If an occurrence fails, for example because a member left, the template is paused, the error is recorded and the creator is notified. Resuming skips the paused period. Edits apply to future occurrences only.

### Multi-currency
Each expense has one currency, and balances are per currency. Analytics show one currency at a time. Conversion is opt-in (Plus): it uses the user's own `exchange_rate_snapshots` (latest on or before the expense date, inverse pairs allowed). The UI says "converted" and lists anything it couldn't convert. Owenil never claims a rate is live.

## Data model (tables)

`profiles`, `user_preferences`, `friendships` (canonical `user_a < user_b`, unique), `friendship_invitations` (token hash), `groups`, `group_members` (role and status, one owner), `group_invitations` (token hash, uses, expiry), `categories` (16 built-in plus custom), `expenses`, `expense_payers`, `expense_participants`, `expense_splits`, `expense_items`, `expense_item_assignments`, `expense_revisions` (audit snapshots), `ledger_entries`, `settlements`, `recurring_expense_templates`, `recurring_expense_occurrences`, `comments`, `activity_events`, `notifications`, `budgets`, `exchange_rate_snapshots`, `split_templates` (presets), `saved_filters`, `subscription_entitlements`, `subscription_events`, `receipt_metadata`, `idempotency_records`, `rate_limit_events`, `currencies`, `app_settings`.

Design decisions:
- `expense_participants` (inputs) and `expense_splits` (outputs) are separate, so the original intent stays auditable.
- `ledger_entries` and `expense_revisions` were added to the requested list to give an auditable, append-only financial model.
- `profiles.id` intentionally has no FK to `auth.users`. On account deletion the profile is anonymised, so other people's history stays consistent.
- **Deletion and archival policy:**
  - Expenses: soft delete, restorable.
  - Settlements: reversed, never deleted.
  - Groups: archived (read-only) or soft-deleted, and deletion only when settled.
  - Members: `left` or `removed` rows are kept.
  - Accounts: anonymised, and only when all balances are zero.

## Web app

- **Routing:** React Router with `basename=/owenil`. Pages are lazy-loaded for code splitting.
- **State:** TanStack Query. `invalidateFinancial()` refreshes everything derived from the ledger after any money change.
- **Forms:** React Hook Form with Zod for auth and groups. The expense form keeps local state and calls the core engine on every keystroke to preview each person's share.
- **Design tokens:** HSL CSS variables in `src/index.css`, light and dark, mapped in `tailwind.config.js` (colours, radii, shadows, motion easing). Fonts are Sora (display) and Inter (text), self-hosted through Fontsource.
- **Motion:**
  - Framer Motion powers page transitions, staggered cards, animated balances, the settlement success check and bottom sheets.
  - `MotionConfig reducedMotion="user"` plus a CSS reduced-motion override.
  - Themes switch with a short colour transition.
- **Charts:** Recharts.
  - Single-series magnitude uses bars in the brand colour.
  - The two-series comparison uses validated categorical colours with a legend and line-style difference.
  - Every chart has tooltips and a table view.
- **Accessibility:** semantic landmarks, skip link, labelled controls, `role=radiogroup` segmented controls, focus rings, colour never used alone (icons and labels on status), dialogs and sheets from Radix.

## Hosting (GitHub Pages)

The app is static, so GitHub Pages serves it from the public repository `vishnumurali/owenil`. A push to `main` runs the tests, builds with the base path `/owenil/` and publishes `dist/`. Static hosting can't run code or send headers, so:
- `404.html` is a copy of `index.html`, so deep links boot the app and the client router takes over
- the CSP ships as a `<meta>` tag added to production builds
- `public/theme-init.js` refuses framing (meta tags can't set `frame-ancestors`)

Details and rollback are in [Deployment](DEPLOYMENT.md).
