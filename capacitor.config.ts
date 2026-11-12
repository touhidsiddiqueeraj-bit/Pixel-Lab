import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration — wraps the statically exported Next.js app
 * (`out/`, produced by `npm run build:apk`) inside a native Android shell.
 *
 * Build flow:
 *   npm run build:apk     -> writes static site to out/
 *   npx cap sync android  -> copies out/ into android/app/src/main/assets/public
 *   cd android && ./gradlew assembleRelease -> signed APK
 */
const config: CapacitorConfig = {
  appId: 'com.pixellab.editor',
  appName: 'Pixel Lab',
  webDir: 'out',
  android: {
    // Serve bundled assets over a https-scheme URL so browsers APIs that
    // require a secure context (canvas, clipboard, localStorage) keep working.
    allowMixedContent: false,
    // Android 15+ enforces edge-to-edge for apps targeting SDK 35, which made
    // the WebView draw under the status bar ("content clipped by the
    // notification bar"). 'force' pads the WebView with the real system-bar /
    // display-cutout insets on every Android version (zero insets are a
    // no-op), so app content never sits under the bars. Capacitor 7's default
    // is 'disable'.
    adjustMarginsForEdgeToEdge: 'force',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
