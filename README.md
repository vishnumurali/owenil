# Owenil

**Shared expenses. Clear balances. Better together.**

Owenil is an expense-sharing web app for friends, couples, families, travellers and flatmates. You split bills fairly, track who owes whom, record repayments and see where shared money goes. It's built web-first with React, TypeScript, Vite and Supabase. The business logic lives in a shared TypeScript package that the future React Native (Expo) apps will reuse.

> Owenil records shared expenses. It never moves money and never asks for bank or card details.

- **Live URL:** https://vishnumurali.github.io/owenil/ (GitHub Pages, deployed on every push to `main`)
- **Docs:** [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md) · [Supabase setup](docs/SUPABASE_SETUP.md) · [Deployment](docs/DEPLOYMENT.md) · [Mobile](docs/MOBILE.md) · [Known limitations](docs/KNOWN_LIMITATIONS.md)

## Features

| Area | What's included |
|---|---|
| Accounts | Email and password sign-up with email verification, optional **Continue with Google** (free; appears once enabled in Supabase), login, password reset, persistent sessions, onboarding, profile, default currency, time zone, theme (light, dark or system), data export, account deletion |
| Groups | Trip, home, couple, family and outing groups. Owner, admin and member roles. Secure invite links (only a hash is stored). Archive, leave, remove members, transfer ownership, activity feed, group default split |
| Friends | Link-based invitations (optionally addressed to an email), accept or decline, no duplicate friendships, one-to-one expenses outside groups |
| Expenses | Create, edit, duplicate, delete and restore. Multiple payers, 16 categories plus custom ones, notes, tags, search, filters, sorting, pagination, comments, full revision history |
| Splitting | Equal, exact amounts, percentages, weighted shares, equal plus adjustments, itemized receipts with tax, tip and discount. Excluded participants, live per-person preview, deterministic paisa rounding |
| Ledger | Append-only ledger, balances derived from it, partial and full repayments, settlement reversals, debt simplification, per-currency balances that are never mixed |
| Pay with UPI | Save your UPI ID once. When friends settle up in INR, they get an **Open UPI app** button (phone) or a **QR code** (computer) with your UPI ID, the amount and a note filled in, for GPay, PhonePe, Paytm, BHIM or any UPI app. Free: no payment gateway or fees. The payer records the repayment after paying |
| Recurring | Weekly, monthly, quarterly and yearly schedules. Pause, resume, cancel, edit future occurrences. Generated hourly on the server by `pg_cron`. Manual "Run due now" trigger |
| Owenil Plus | Itemized receipts, private receipt uploads, budgets and alerts, currency conversion from your own rate snapshots, saved split presets and filters, detailed analytics, CSV and JSON exports, group reports. A development-only entitlement switch, gated by the database |
| Analytics | Monthly, weekly and yearly totals, categories, groups, payer contributions, largest expenses, year-over-year comparison, recurring and settlement totals, budget vs actual |
| Design | Original brand and icon, design tokens, light and dark themes, responsive sidebar and mobile tab bar, quick-add button, animated balances and charts, skeletons, success animations, reduced-motion support |

## Tech stack

| Layer | Choice (pinned versions) |
|---|---|
| Web | React 18.3.1, TypeScript 5.9.3 (strict), Vite 5.4.21, Tailwind CSS 3.4.17, Radix UI primitives (shadcn-style components), Framer Motion 11.18.2, Lucide 0.544.0, React Hook Form 7.63.0, Zod 3.25.76, TanStack Query 5.90.2, Recharts 2.15.4, React Router 6.30.6, Sonner 2.0.7 |
| Backend | Supabase: Auth, Postgres with RLS, Storage, `pg_cron` (supabase-js 2.78.0) |
| Hosting | GitHub Pages, built and published by GitHub Actions (`.github/workflows/deploy.yml`) |
| Tests | Vitest 2.1.9, React Testing Library 16.3.0, PGlite 0.3.14 (Postgres 17 compiled to WASM, used for offline database tests), Playwright 1.55.1 |
| Shared logic | `packages/core` (`@owenil/core`): money, splitting engine, ledger, simplification, recurrence, analytics, validation, CSV |

The versions are chosen to run on the installed **Node 18.17**. Newer supabase-js, Playwright and Vite 7 need Node 20+. GitHub Actions builds with Node 22. See [Upgrading Node](docs/KNOWN_LIMITATIONS.md#node-18).

## Project structure

```
packages/core/          Shared domain logic (no React; also used by mobile later)
  src/money.ts          Minor-unit parsing/formatting, conversion with explicit rates
  src/split.ts          Splitting engine (6 methods, deterministic rounding)
  src/ledger.ts         Pairwise attribution (mirrors the SQL), balances
  src/simplify.ts       Debt simplification
  src/recurrence.ts     Schedule maths (mirrors the SQL generator)
  src/analytics.ts      Aggregations, budgets
  src/validation.ts     Zod schemas
  test/                 Unit + randomized invariant tests
src/                    Web app
  components/           UI kit (ui/), layout, charts, domain components
  data/                 Supabase queries (TanStack Query) + balance derivation
  features/<area>/      Pages per feature (auth, dashboard, groups, expenses, …)
  lib/                  Supabase client, env, theme, errors, hooks
supabase/migrations/    Versioned SQL: schema, RLS, functions, storage/cron, privileges
scripts/                Migrate, seed demo data, set tester, icons, recurring trigger
tests/sql/              Offline DB tests (real migrations on PGlite + Supabase stubs)
tests/db/               Hosted DB tests (real Supabase: RLS, storage, exports)
tests/e2e/              Playwright browser tests
.github/workflows/      Test, build and deploy to GitHub Pages
```

## Quick start

```bash
npm install                      # install dependencies
cp .env.example .env.local       # then fill in the values (see Supabase setup)
npm run db:migrate               # apply supabase/migrations to your project
npm run db:verify                # check tables, RLS, functions, bucket, cron
npm run db:seed                  # optional: fictional demo data (6 users, 3 groups)
npm run dev                      # http://localhost:5173/owenil/
```

### All commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server at `http://localhost:5173/owenil/` |
| `npm run build` | Strict typecheck, then production build into `dist/` (with `404.html` SPA fallback and CSP meta tag) |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit, component and offline database tests (no network needed) |
| `npm run test:db` | Hosted Supabase tests: RLS with separate users, storage, exports |
| `npm run test:e2e` | Playwright browser tests (needs `.env.local`; `npx playwright install chromium` once) |
| `npm run db:migrate` | Apply pending migrations (`-- --print` writes `supabase/combined.sql` for the SQL editor instead) |
| `npm run db:verify` | Verify schema, RLS, policies, functions, grants, storage bucket and cron jobs |
| `npm run db:seed` / `db:reset-demo` / `db:wipe-demo` | Create, recreate or remove demo data |
| `npm run db:tester -- you@example.com` | Allow an account to use the development Plus switch |
| `npm run db:tester -- --mode off` | Turn the development switch off for everyone (production) |
| `npm run recurring:run` | Run the recurring generator once (the same job `pg_cron` runs hourly) |
| `git push` to `main` | Test, build and deploy to GitHub Pages (see [Deployment](docs/DEPLOYMENT.md)) |

## Demo data

`npm run db:seed` creates six fictional people and three groups with 30+ expenses. The groups are:

- **Goa Getaway**: unsettled, uses every split method, multiple payers and a USD expense.
- **Flat 4B**: monthly recurring rent.
- **Kodachadri Trek**: fully settled.

The seed also adds non-group expenses, settlements (one of them reversed), comments, budgets and an exchange-rate snapshot.

Everything is flagged `is_demo` and shows a **Demo** badge in the app. Each demo account gets a random password, written to `demo-credentials.local.json`, which is gitignored. There are no shared or guessable passwords. `aarav@demo.owenil.test` has Owenil Plus through the development entitlement. Run `npm run db:reset-demo` to recreate everything.

## How the money works

Short version (details in [Architecture](docs/ARCHITECTURE.md#financial-model)):

1. **Integer amounts.** Every amount is an integer number of minor units (paise, cents, yen), with currency-specific precision: JPY has 0 decimals, INR 2, KWD 3.
2. **Exact splits.** The engine distributes leftover units with the largest-remainder method, breaking ties by user id. Allocations always sum exactly to the total.
3. **Ledger instead of totals.** An expense becomes pairwise "A owes B" lines in an **append-only ledger**. Balances are always computed from the ledger, never stored.
4. **Atomic edits.** An edit reverses the old lines and writes the new ones in one transaction, with version checks, so it applies exactly once. A delete is a reversal; a restore re-applies.
5. **Idempotent requests.** Expense creation and settlements take idempotency keys, so a retried request can never be recorded twice.
6. **Suggestions aren't payments.** Debt simplification only suggests transfers. Nothing changes until someone records a repayment.
