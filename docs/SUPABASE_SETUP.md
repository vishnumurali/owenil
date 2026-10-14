# Supabase setup (free plan)

Everything here works on the **Supabase Free** plan. Never paste your database password or secret key into chat or commit it. They belong only in `.env.local`.

## Fastest path: automated provisioning

1. Open https://supabase.com/dashboard/account/tokens and click **Generate new token**. Name it `owenil-setup`.
2. Add the token to `.env.local` as `SUPABASE_ACCESS_TOKEN=sbp_…`. Don't paste it anywhere else.
3. Run:
   ```bash
   npm run supabase:provision   # finds or creates "owenil-dev" (Free plan, Mumbai), writes keys to .env.local, sets auth URLs
   npm run db:migrate && npm run db:verify
   ```
   The script refuses to create a project in an organization that isn't on the Free plan. To use an existing project, run `npm run supabase:provision -- --ref <project-ref>`. Without a DB connection string, SQL runs through the Management API.
4. After setup you can revoke the token, or keep it for future migrations.

The manual steps below do the same thing by hand.

## 1. Create the project

1. Open https://supabase.com/dashboard and sign in, or create an account.
2. Click **New project**.
   - **Name:** `owenil-dev` for testing (create `owenil-production` later).
   - **Database password:** generate a strong one and save it in your password manager.
   - **Region:** **South Asia (Mumbai)** for Indian users.
   - **Plan:** Free.
3. Wait until the project shows *Active*.

## 2. Collect connection settings into `.env.local`

Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to find it | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | Project Settings → **Data API** (or API Keys) → Project URL | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Project Settings → **API Keys** → *Publishable key* (`sb_publishable_…`) or the legacy `anon` key | No (safe only because of RLS) |
| `SUPABASE_SECRET_KEY` | Project Settings → **API Keys** → *Secret key* (`sb_secret_…`) or the legacy `service_role` key | **Yes**: local scripts and tests only |
| `SUPABASE_DB_URL` | **Connect** (top bar) → *Session pooler* → URI, with your DB password substituted | **Yes** |

Use the **Session pooler** URI (IPv4). The direct connection host is IPv6-only and often fails on home networks.

## 3. Apply the schema

```bash
npm run db:migrate     # applies supabase/migrations/* in order, inside transactions
npm run db:verify      # checks tables, RLS, policies, function privileges, bucket, cron
```

**Alternative without a DB connection:** run `npm run db:migrate -- --print`, then paste `supabase/combined.sql` into **SQL Editor** and click **Run** once.

**If `pg_cron` isn't enabled:** go to **Database → Extensions**, enable `pg_cron`, then re-run the last block of `20261014000004_storage_cron_reference.sql`.

## 4. Authentication settings

**Authentication → URL Configuration**
- **Site URL:** `https://vishnumurali.github.io/owenil/`
- **Redirect URLs:** add `https://vishnumurali.github.io/owenil/**` and `http://localhost:5173/owenil/**`
- Or run `npm run supabase:provision -- --auth-urls` to set both.

**Authentication → Sign In / Providers → Email**
- Keep **Confirm email** on.
- Set the minimum password length to 8 or more.

**Email delivery (important).** Supabase's built-in email service is for testing only. It's heavily rate-limited and only delivers to addresses that belong to your Supabase organization's team. To let other testers sign up, either:
- configure free custom SMTP under **Authentication → Emails → SMTP Settings**, for example Brevo (300 emails/day free) or Resend (3,000/month free), or
- invite testers to your Supabase organization, or
- create test accounts with `npm run db:seed`, which uses pre-confirmed demo users.

## 5. Optional: Google sign-in (free)

Google charges nothing for sign-in and Supabase includes it on the Free plan. People who use Google skip the verification email, which also avoids the built-in email limits.

1. In Google Cloud Console, create a project, then go to **Google Auth Platform**.
   - **Branding:** app name `Owenil`. Home page `https://vishnumurali.github.io/owenil/`. Authorized domains `vishnumurali.github.io` and `<ref>.supabase.co`.
   - **Data access:** the scopes `openid`, `userinfo.email` and `userinfo.profile`. These don't need Google review.
   - **Audience:** **External**, then **Publish app**. Without publishing, only listed test users can sign in.
2. Under **Clients**, choose **Create client** → **Web application**.
   - **Authorized JavaScript origins:** `https://vishnumurali.github.io` and `http://localhost:5173`
   - **Authorized redirect URIs:** `https://<ref>.supabase.co/auth/v1/callback`
3. Put the client ID and secret in `.env.local` as `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
4. Run `npm run supabase:provision -- --google`. This stores them in Supabase Auth and turns the provider on; `-- --google-off` turns it off.

The **Continue with Google** button appears on the sign-in and sign-up pages as soon as the provider is on. No rebuild is needed, because the app asks Supabase which providers are enabled. A Google account with the same verified email as an existing Owenil account is linked to it automatically.

## 6. Optional: demo data and testers

```bash
npm run db:seed                         # fictional demo data; logins in demo-credentials.local.json
npm run db:tester -- you@example.com    # let your own account use the development Plus switch
```

## 7. Receipts storage

The migration creates the private `receipts` bucket (5 MB limit; images and PDF) with RLS policies. If the bucket is missing, expenses still work without images, and the app explains why an upload failed.

## Free-plan notes

The Free plan includes:
- 500 MB database
- 1 GB file storage
- 50,000 monthly active users
- `pg_cron`

Free projects **pause after about a week of inactivity**. Resume them from the dashboard. Owenil doesn't enable any paid add-ons.
