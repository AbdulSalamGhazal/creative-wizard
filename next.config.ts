import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
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
