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

## How it's built

| Part | Where |
|---|---|
| Web app, Android mode | `vite build --mode android` → `dist-android/`, base path `/`, settings in `.env.android`. Links that leave the app (invite links, email links) use `VITE_PUBLIC_URL`, the website. The page stays inside the safe area (no `viewport-fit=cover`), so the status and navigation bars never cover content |
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
- **iOS** works the same way (`npx cap add ios`), but building needs a Mac with Xcode, and installing on iPhones outside TestFlight needs a paid Apple developer account.
- **A fully native UI** (React Native or Expo) can reuse `@owenil/core` (money, splitting, ledger, simplification, recurrence and UPI link rules) unchanged if the app ever needs it.
