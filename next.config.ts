import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// Applied to every response. None of this is a substitute for the
// server-side auth/authorization checks elsewhere in the app (requireHousehold
// et al.) — these are defense-in-depth against a browser being tricked into
// doing something on this origin's behalf (clickjacking, MIME-sniffing a
// user-uploaded-looking response as script, a compromised third-party script
// exfiltrating data) rather than protections against a malicious server-side
// caller, which per-action checks already cover.
const securityHeaders = [
  // No legitimate reason to frame this app (it isn't an embeddable widget)
  // — blocks clickjacking (an invisible iframe of e.g. deleteHouseholdAction's
  // confirm button overlaid on an attacker's page).
  { key: "X-Frame-Options", value: "DENY" },
  // Stops the browser from ever guessing a response's MIME type (e.g.
  // treating an uploaded-looking file as executable script) based on its
  // content instead of its declared Content-Type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak this app's full URLs (which can contain invite tokens, e.g.
  // /join/<token>) to a third-party site when a user clicks an outbound link.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This app doesn't use the camera/mic/geolocation APIs itself and embeds
  // nothing that should be able to request them via this origin.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // HSTS: once a browser has loaded this over HTTPS, never let it silently
  // downgrade to plain HTTP (protects against SSL-stripping). Harmless in
  // local dev over http:// — browsers only honor this header on HTTPS
  // responses in the first place.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// withSentryConfig's build-time plugin uploads source maps (and creates a
// release) by talking to Sentry's API, which normally wants
// SENTRY_AUTH_TOKEN. Only apply it when Sentry is actually configured
// (SENTRY_DSN set) -- local dev and CI build with zero Sentry env vars and
// must not gain a dependency on Sentry credentials or network access to
// build at all. Source map upload itself is separately gated on
// SENTRY_AUTH_TOKEN so a deployment that only sets SENTRY_DSN (error
// reporting, no source maps) still builds without a token.
export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
      silent: true,
      telemetry: false,
    })
  : nextConfig;
