# Owenil for Android

The Android app is the same React app as the website, packaged with
[Capacitor](https://capacitorjs.com) 8 (free, MIT licence) and running in the
phone's WebView. Every screen, rule and fix ships to the website and the app
together. One native addition exists only in the app: **Pay with GPay**.

**Download (latest build):** https://github.com/vishnumurali/owenil/releases/download/android-latest/Owenil.apk

## Install on a phone

1. On the phone, open the link above (or the [android-latest release page](https://github.com/vishnumurali/owenil/releases/tag/android-latest)) and download **Owenil.apk**.
2. Open the download. Android asks to allow installing apps from your browser: allow it once.
3. Tap **Install**, then **Open**.

New builds install over the old one and keep you signed in, because every build is signed with the same key. Android needs version 7.0 or newer.

## Pay with GPay (Android app only)

When you pay someone who has saved a UPI ID, in INR:

1. **Pay with GPay** opens Google Pay directly, with their UPI ID, name, amount and a note filled in. **Other UPI app** lets you pick PhonePe, Paytm, BHIM or another app.
2. You approve the payment in Google Pay.
3. Google Pay reports the result back to the app:
   - **Success:** Owenil marks it paid immediately and saves the UPI reference in the repayment note. No extra tap is needed.
   - **Failure:** nothing is recorded.
   - **Pending, or no answer** (for example you pressed Back): Owenil asks "Did it go through?", as on the website.

This works for one expense and for the combined **Pay** tab. Browsers never show these buttons; there, the UPI link or QR code and the "Did it go through?" question are used, because websites can't receive the UPI result.

## Sign-in and email links (same as the website)

- **Continue with Google** opens Google's page in a Chrome tab (Google blocks sign-in inside apps' built-in browsers), then comes back to the app through its own link, `io.github.vishnumurali.owenil://auth/callback`, and finishes signing in (PKCE: the one-time code only works in the app that asked for it).
- **Sign-up confirmation and password-reset emails** requested in the app point back to the app too (`…://auth/callback`, `…://reset-password`). Open them on the same phone. If one is opened elsewhere, the email still gets confirmed and you can sign in with your password.
- The link is in the Supabase redirect allow-list (`npm run supabase:provision -- --auth-urls`).

## Find friends from contacts (Android app only)

**Friends → From contacts** (or **All → From contacts**) asks for contacts access once, then:
- turns each phone number and email into a one-way code (SHA-256) on the phone; numbers are normalised to +91… first;
- asks Owenil which codes belong to people who allow being found;
- lists **On Owenil** (Add / Accept, or Add all) and **Invite** (WhatsApp, SMS or email with a private invitation link).

Contacts are never uploaded or stored. The native part is `ContactsPlugin.java` (READ_CONTACTS, asked only at that moment).

## How it's built

| Part | Where |
|---|---|
| Web app, Android mode | `vite build --mode android` → `dist-app/`, base path `/`, settings in `.env.android`. Links that leave the app (invite links, email links) use `VITE_PUBLIC_URL`, the website. The page stays inside the safe area (no `viewport-fit=cover`), so the status and navigation bars never cover content |
| Native project | `android/` (Capacitor template). App id `io.github.vishnumurali.owenil` |
| UPI plugin | `android/app/src/main/java/io/github/vishnumurali/owenil/UpiPlugin.java`: `canPay` and `pay` (starts the UPI intent with `startActivityForResult` and returns the app's `response`). Registered in `MainActivity`. The manifest declares `<queries>` for `upi://pay` links (scheme and host, the form UPI apps register) and Google Pay, for Android 11+ package visibility |
| JS bridge | `src/lib/native-upi.ts` (`isAndroidApp`, `payWithUpiApp`, `parseUpiResponse`) and `AndroidUpiPay` in `src/features/payments/PayDialog.tsx` |
| Test UPI app | `android/fakeupi`: a test-only app that answers every `upi://pay` request with SUCCESS, so CI can test the payment round trip without Google Pay. It's never published |
| Icons and splash | `npm run icons` renders the launcher icons (legacy, round, adaptive layers) and splash screens from the same design as the web icon |
| Signing | A PKCS#12 key (alias `owenil`). CI reads it from the secrets `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`. The owner's backup is `android-signing.local.p12` and `.txt` (gitignored) |

## Build pipeline

`.github/workflows/android.yml` runs on every push to `main`:

1. **build:**
   - typecheck, then build the web app in Android mode;
   - `cap sync`, then `gradlew assembleRelease`, signed, with version `1.0.<run number>`;
   - check the package name, SDK levels and signature with `aapt2` and `apksigner`.
2. **emulator-test:** boots an Android 14 emulator and runs `scripts/android-smoke.mjs`. The script drives the app with `adb` and the WebView's DevTools connection (the one `chrome://inspect` uses), and every step has a time limit. It:
   - installs and opens the app;
   - checks the web app runs as the Android build;
   - calls the native UPI plugin (`canPay`; `pay` reports a missing Google Pay and refuses non-UPI links);
   - checks the App, Browser, Upi and Contacts plugins are built in, adds a contact to the emulator and reads it back through the contacts plugin;
   - opens the app through its own link (`…://auth/callback`) and checks it lands on the right page, and that an unusable sign-in code is explained;
   - pays through a test-only fake UPI app and checks Owenil gets that app's SUCCESS answer back and returns to the front. This is the same round trip as with Google Pay;
   - checks the sign-in page fits the screen, no link points at the phone itself and the app has no uncaught errors.

   Screenshots are kept as a run artifact. On failure, the artifact also has the screen's text and the device log.
3. **publish:** only after the emulator test passes, replaces the `android-latest` pre-release with the new `Owenil.apk`.

### Building locally (optional)

Needs Node 22, JDK 21 and the Android SDK (Android Studio includes both).

```bash
npm run android:build          # vite build --mode android && cap sync android
npx cap open android           # open in Android Studio, then Run ▶ on a phone or emulator
```

To debug the app's WebView on a USB-connected phone, open `chrome://inspect` in desktop Chrome. Testing builds enable WebView debugging.

## Limits and next steps

- **Testing builds.** The APK is installed from GitHub, not the Play Store. Publishing on Google Play needs a one-time $25 developer account, which isn't free, so it isn't done. With Play App Signing the existing key can serve as the upload key.
- **Google Pay and personal UPI IDs.** Some UPI apps limit or decline payments to personal (non-merchant) UPI IDs when the payment is started from another app, or show a risk warning. If that happens, **Other UPI app** or scanning a QR code inside the UPI app still works. Owenil can't change that policy.
- **Links open the website.** Invite links (`/join/…`) open in the browser. Android App Links into the app would need an `assetlinks.json` at the root of `vishnumurali.github.io` (the user-site repository) or a custom domain.
- **iPhone:** see [IOS.md](IOS.md). The iPhone app is built in CI on GitHub's macOS runners and installed by sideloading with a free Apple ID (renew every 7 days); the website can also be added to the Home Screen.
- **A fully native UI** (React Native or Expo) can reuse `@owenil/core` (money, splitting, ledger, simplification, recurrence and UPI link rules) unchanged if the app ever needs it.
