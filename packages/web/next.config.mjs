/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@contractops/core", "@contractops/schemas"],
};

export default nextConfig;
