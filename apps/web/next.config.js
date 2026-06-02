/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
    // `pg` ships Node-built-in deps (net/tls/pg-native) webpack can't bundle.
    // Externalizing keeps it out of the webpack bundle AND makes Next include
    // it in the serverless function's node_modules so route handlers can
    // require("pg") at runtime. Without this, the auth routes threw
    // "Cannot find module 'pg'" → caught by the lego as 500 "internal error".
    serverComponentsExternalPackages: ["pg"],
  },
};

module.exports = nextConfig;
