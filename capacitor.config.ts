import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Owenil for Android and iPhone: the same React app (built with
 * `vite build --mode android` or `--mode ios` into dist-app/) running in
 * Capacitor's web view, plus small native plugins: UPI (Android, paying with
 * GPay) and Contacts (android/.../ContactsPlugin.java, ios/App/App/OwenilPlugins.swift).
 */
const config: CapacitorConfig = {
  appId: 'io.github.vishnumurali.owenil',
  appName: 'Owenil',
  webDir: 'dist-app',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Testing builds: lets chrome://inspect debug the app on a connected phone.
    webContentsDebuggingEnabled: true,
  },
  ios: {
    // Pages draw edge to edge and pad themselves with the safe-area insets.
    contentInset: 'never',
    // No long-press link previews: it should feel like an app, not a web page.
    allowsLinkPreview: false,
    // Testing builds: lets Safari's Web Inspector debug the app.
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    SystemBars: {
      // Pages stay inside the safe area (the Android build has no viewport-fit=cover).
      insetsHandling: 'native',
      initialViewportFitValueHint: 'auto',
    },
  },
};

export default config;
