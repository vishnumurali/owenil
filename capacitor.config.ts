import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Owenil for Android: the same React app (built with `vite build --mode android`
 * into dist-android/) running in Capacitor's WebView, plus a small native UPI
 * plugin (android/app/src/main/java/.../UpiPlugin.java) for paying with GPay.
 */
const config: CapacitorConfig = {
  appId: 'io.github.vishnumurali.owenil',
  appName: 'Owenil',
  webDir: 'dist-android',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Testing builds: lets chrome://inspect debug the app on a connected phone.
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
