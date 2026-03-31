/** @type {import('next').NextConfig} */

const _raw = process.env.NEXT_PUBLIC_API_BASE;
const apiUrl = _raw
  ? _raw.startsWith("http") ? _raw : `https://${_raw}`
  : "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
