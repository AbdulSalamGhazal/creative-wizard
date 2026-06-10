import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    // Don't reuse a previously-rendered page from the client-side Router Cache
    // on navigation — always re-fetch from the server. The cache was serving
    // stale, pre-cookie page renders for some routes, so the remembered
    // date-range default appeared to "work on some pages and not others".
    // Dashboards are dynamic anyway, so the freshness is worth the re-fetch.
    staleTimes: { dynamic: 0, static: 0 },
  },
  images: {
    // Creative thumbnails are uploaded to Vercel Blob, served from
    // <store-id>.public.blob.vercel-storage.com. Allow next/image to optimize
    // and serve responsive variants of them.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
