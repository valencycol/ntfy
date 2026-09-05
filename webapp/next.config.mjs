/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the Cloudflare Worker serves the built `out/` directory as
  // assets and keeps /api/* and the .ics feed for itself. No Node server.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
