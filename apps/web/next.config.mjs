/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Small, self-contained production server — what the Dockerfile copies
  // into the runtime image (no need for the full node_modules tree there).
  output: "standalone",
  // Proxying to @hackpulse/api (ADR-002: web never touches the database
  // directly) is done by app/api/v1/[...path]/route.ts, NOT next.config's
  // rewrites() — rewrites() destinations are resolved once at build time,
  // so a runtime env var like HACKPULSE_API_URL (only known once the
  // container is actually running, e.g. the `api` service DNS name in
  // Docker Compose) silently falls back to whatever it evaluated to at
  // image-build time. A route handler reads process.env fresh per request.
};

export default nextConfig;
