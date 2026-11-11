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
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
