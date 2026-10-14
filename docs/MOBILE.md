# Android and iOS continuation plan

The web MVP was built so that the mobile apps reuse the backend and all business rules unchanged.

## What is reused as-is

| Piece | Reused from |
|---|---|
| Backend | The same Supabase project: Auth, RLS, RPCs, Storage, `pg_cron` |
| Money and splitting | `@owenil/core`: `computeSplit`, `parseMoney`, `formatMoney`, `attributeExpense`, `simplifyDebts` |
| Validation | `@owenil/core` Zod schemas (`expensePayloadSchema`, `settlementPayloadSchema`, …) |
| Schedules and analytics | `occurrenceDate`, `upcomingOccurrences`, `totalsByMonth`, `evaluateBudgets` |
| Data contracts | `src/types/db.ts` (move it into `packages/core` or a new `packages/api`) |
| Balance derivation | `src/data/balances.ts` (pure; move it into `packages/core`) |

The core package has no DOM or React dependency. It needs only `zod` and the standard `Intl` APIs. Hermes supports `Intl.NumberFormat`; enable full Intl in Expo SDK 50+ if you need narrow currency symbols.

## Steps

```bash
# 1. Convert to an npm workspace monorepo (web app moves into apps/web)
#    root package.json:  "workspaces": ["packages/*", "apps/*"]
git mv src apps/web/src   # plus index.html, vite.config.ts, public/, tailwind/postcss configs

# 2. Create the Expo app
npx create-expo-app@latest apps/mobile -t expo-template-blank-typescript
cd apps/mobile
npx expo install expo-router expo-secure-store expo-image-picker expo-camera expo-notifications \
  react-native-safe-area-context react-native-screens @supabase/supabase-js react-native-url-polyfill
npm i @owenil/core@* @tanstack/react-query zod
```

### Supabase client on mobile

```ts
import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const storage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL!, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
});
```

Sessions are stored in the Keychain on iOS and in Keystore-backed storage on Android. Note: SecureStore values are limited to about 2 KB, so use a chunking adapter if the session grows.

### Platform work

| Concern | Plan |
|---|---|
| Navigation | Expo Router tabs: Home, Groups, Add (+), Balances, More. Stacks for detail screens; deep links `owenil://join/group/<token>` and universal links on `vishnumurali.github.io/owenil/join/*` (the association files must sit at the domain root, so this needs the `vishnumurali.github.io` repository or a custom domain) |
| Auth redirects | Add `owenil://auth/callback` to Supabase Redirect URLs; use `expo-linking` and `supabase.auth.exchangeCodeForSession` |
| Camera and receipts | `expo-image-picker` / `expo-camera`, compressed under 5 MB, then uploaded to `receipts/<uid>/…` like the web app does (requires Plus) |
| Push notifications | Add a `push_tokens` table (RLS: owner only). A database webhook on `notifications` insert calls a Supabase Edge Function that sends through Expo Push (free). Keep in-app notifications as the source of truth |
| Offline | TanStack Query persistence (AsyncStorage) for reads. Financial writes stay online-only, and idempotency keys make retries safe |
| Haptics and motion | `expo-haptics` on save and settle. Reanimated for balance and success animations; respect "reduce motion" |
| Theming | Port the tokens from `src/index.css` into a TypeScript theme object (light and dark) |

### Store releases

```bash
npm i -g eas-cli
eas login
eas build:configure
eas build -p android --profile preview      # internal APK for testing
eas build -p ios --profile preview          # needs an Apple Developer account
eas submit -p android | ios                 # when ready
```

Before publishing, decide on real subscriptions (Google Play Billing, App Store IAP) and keep them behind a feature flag. Server-side entitlements already have `source = 'app_store' | 'play_store'`. Receipt validation must happen on a trusted server, such as an Edge Function, and never in the app.
