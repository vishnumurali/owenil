# Owenil on iPhone

There are two ways to use Owenil on an iPhone. Both are free.

## 1. Add the website to your Home Screen (easiest)

1. Open https://vishnumurali.github.io/owenil/ in **Safari** on the iPhone.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**, then **Add**.

Owenil gets its own icon and opens full screen like an app. Everything works except the two things only native apps can do: reading the UPI app's payment result (you confirm with "Did it go through?" instead) and finding friends from your contacts.

## 2. Install the iPhone app (sideloading)

The iPhone app is the same app inside a native shell, with **Find friends from contacts** and Google sign-in through Safari. Apple only lets apps onto an iPhone if they are signed. Without the paid Apple Developer Program (US$99 a year, needed for the App Store and TestFlight), you can sign it yourself with a free Apple ID:

**Download:** https://github.com/vishnumurali/owenil/releases/download/ios-latest/Owenil-unsigned.ipa

**One-time setup on a Windows PC:**
1. Install **iTunes** and **iCloud** from apple.com (the downloads from Apple's website, not the Microsoft Store versions).
2. Install **Sideloadly** (free, https://sideloadly.io). AltStore (https://altstore.io) works the same way.
3. Connect the iPhone with a USB cable, unlock it, and tap **Trust** on the iPhone.
4. On the iPhone (iOS 16 or later): **Settings → Privacy & Security → Developer Mode → On**, then restart when asked.

**Install:**
1. Open Sideloadly, drag **Owenil-unsigned.ipa** into it, enter your Apple ID, and click **Start**. A separate free Apple ID just for this is a good idea.
2. On the iPhone: **Settings → General → VPN & Device Management**, tap your Apple ID under Developer App, then **Trust**.
3. Open Owenil.

**Limits of free signing:** the app stops opening after **7 days**. Run Sideloadly again (same steps) to renew it; your data stays. A free Apple ID can have at most 3 sideloaded apps at a time.

## What differs from Android

| | Android app | iPhone app | Website |
|---|---|---|---|
| Pay with UPI | Opens Google Pay and **reads the result** | Opens the UPI app; you confirm "Did it go through?" | Same as iPhone app |
| Find friends from contacts | Yes | Yes | No |
| Google sign-in, email links | In the app | In the app | In the browser |

iOS doesn't let apps receive a UPI payment result, so the iPhone app can't mark a payment paid automatically.

## How it's built

- iOS project: `ios/` (Capacitor 8, Swift Package Manager), bundle ID `io.github.vishnumurali.owenil`, iOS 15 or later, portrait.
- Web part: `vite build --mode ios` (settings in `.env.ios`) into `dist-app/`, then `npx cap sync ios`. The iPhone build draws edge to edge (`viewport-fit=cover`) and pads with the safe-area insets.
- Native code: `ios/App/App/OwenilPlugins.swift` (the Contacts plugin, registered by `OwenilViewController`). App link `io.github.vishnumurali.owenil://` in `Info.plist`.
- CI: `.github/workflows/ios.yml` builds on GitHub's macOS runners (free for public repositories), opens the app in an iPhone simulator (start screen and an app link, with screenshots kept as an artifact), builds the unsigned `.ipa` and publishes it as the `ios-latest` pre-release.
- Building locally needs a Mac with Xcode: `npm run ios:build`, then `npx cap open ios`.
