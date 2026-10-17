import { fileURLToPath } from 'node:url';

// Headers that matter for a site showing IDs and health-test photos. A script-src CSP is left out on
// purpose: Next injects inline scripts and a nonce setup is a separate piece of work (docs/SECURITY.md).
const headers = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  serverExternalPackages: ['pdfjs-dist'],
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers },
      // personal documents and exported packets must never be cached by a browser or proxy
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
};
export default nextConfig;
