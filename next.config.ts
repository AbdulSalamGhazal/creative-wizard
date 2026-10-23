import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    // Three upload surfaces post the FILE through a server action (store
    // orders, bulk creatives, the Budget sheet), and Next caps an action body
    // at 1 MB by default — so files over 1 MB failed while every screen said
    // 10 MB (D5, 2026-10-23). 4.5 MB is Vercel's own ceiling on a function
    // request; the app's limit is 4 MB (`MAX_FILE_BYTES`), so a 4 MB file plus
    // its multipart wrapping fits.
    serverActions: { bodySizeLimit: "4.5mb" },
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
