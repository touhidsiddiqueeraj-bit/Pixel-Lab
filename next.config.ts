import type { NextConfig } from "next";

/**
 * BUILD_TARGET=apk switches Next.js to fully-static export mode so the
 * output can be bundled into the Capacitor Android WebView shell.
 * The normal web build keeps `standalone` (Node server) mode.
 */
const isApkExport = process.env.BUILD_TARGET === "apk";

const nextConfig: NextConfig = {
  ...(isApkExport
    ? {
        output: "export" as const,
        images: { unoptimized: true },
      }
    : {
        output: "standalone" as const,
      }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
