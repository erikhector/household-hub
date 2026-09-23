import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isDev = process.env.NODE_ENV === "development";

// Both the receipt-scan OCR (src/components/shopping/receipt-scan-dialog.tsx,
// tesseract.js) and the barcode scanner (src/components/shared/barcode-scanner.tsx,
// the `barcode-detector` ponyfill's zxing-wasm dependency) load their worker
// script / WASM binary / OCR language data from jsdelivr's CDN at their
// default paths rather than a path bundled into our own build — neither
// package is configured with a local corePath/workerPath/langPath, so
// whitelisting the CDN they actually reach (instead of bundling our own copy)
// is what keeps this consistent with what's really shipping.
const JSDELIVR_CDN = ["https://cdn.jsdelivr.net", "https://fastly.jsdelivr.net"];

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
  // This app's own pages (never a cross-origin embed) use the camera for
  // barcode scanning (src/components/shared/barcode-scanner.tsx's
  // getUserMedia() call) — `camera=(self)` allows that while still blocking
  // any framed/embedded third-party origin from requesting it. No use of
  // the mic or geolocation anywhere, so those stay fully denied.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  // HSTS: once a browser has loaded this over HTTPS, never let it silently
  // downgrade to plain HTTP (protects against SSL-stripping). Harmless in
  // local dev over http:// — browsers only honor this header on HTTPS
  // responses in the first place.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Whitelists what this app is allowed to load/run/connect to at all, so
  // that even if an attacker manages to inject markup (a stored-XSS bug we
  // missed) the browser still won't execute a <script src="evil.example">
  // or exfiltrate data via fetch() to an arbitrary origin. `default-src
  // 'self'` is the fallback for every fetch directive not listed below.
  //   - script-src/connect-src include jsdelivr's CDN (see JSDELIVR_CDN
  //     above) for tesseract.js's worker+core+lang-data and the barcode
  //     scanner's zxing-wasm, both loaded at their CDN defaults; and
  //     'wasm-unsafe-eval' since both compile/instantiate WebAssembly
  //     (narrower than 'unsafe-eval' — doesn't permit JS eval()/Function()).
  //   - worker-src allows 'self' plus blob: because tesseract.js spawns its
  //     worker from a same-origin-created Blob URL, not a direct CDN URL.
  //   - img-src allows blob:/data: for camera-frame <canvas> snapshots (the
  //     barcode scanner never uploads a frame, only draws it into a canvas)
  //     and any data:-URI images baked in by the build.
  //   - font-src stays 'self' only — next/font self-hosts the Google fonts
  //     it uses at build time, so no external font host is ever contacted.
  //   - style-src needs 'unsafe-inline' too (also confirmed against a running
  //     dev server): shadcn/ui's Radix- and Base-UI-based components
  //     (dialogs, selects, popovers — see src/components/ui) set inline
  //     `style` attributes for positioning/animation state at runtime, not
  //     just Tailwind's build-time stylesheet, so 'self' alone blocked them.
  //   - object-src 'none', base-uri 'self', form-action 'self',
  //     frame-ancestors 'none' close off plugin embeds, <base>-tag hijacking,
  //     cross-origin form submission, and framing (belt-and-suspenders with
  //     X-Frame-Options above) respectively — this app has no legitimate use
  //     for any of them.
  //   - In dev only, 'unsafe-eval' is added to script-src: React's dev build
  //     uses eval() to recreate server-side error stacks in the browser, and
  //     Turbopack's HMR runtime relies on eval too. Neither happens in a
  //     production build, so production keeps the stricter policy.
  //   - script-src also needs 'unsafe-inline': verified against a running
  //     dev server that Next itself emits inline <script> tags (RSC payload
  //     bootstrapping — self.__next_r) with no nonce/hash, in every render,
  //     not just dev — without it the app doesn't just look wrong, the RSC
  //     stream fails to hydrate at all ("Invariant: Expected a request ID to
  //     be defined"). Matches the Next.js docs' own recommended CSP for apps
  //     that don't opt into per-request nonces via Proxy (see
  //     node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
  //     "Without Nonces") — that requires forcing every page into dynamic
  //     rendering, which is out of scope for this header-only change.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ${JSDELIVR_CDN.join(" ")}${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      `connect-src 'self' ${JSDELIVR_CDN.join(" ")}`,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    // scanShelfPhotoAction (src/lib/actions/inventory-scan.ts) is the one
    // Server Action in this app that takes a photo as its payload — a
    // base64 data URL comfortably clears Next's 1MB default body limit even
    // after ai-shelf-scan-dialog.tsx's client-side downscale.
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
  // Dev-only build-activity badge (bottom-left "N" indicator, never shown in
  // a production build) overlaps the sidebar's "Log out" link on desktop and
  // sits on the first bottom-nav tab at phone width — never affects real
  // users, but gets in the way of manual/Playwright testing against a local
  // dev server (see docs/archive/UX_FRICTION_BACKLOG.md's Housekeeping section).
  devIndicators: false,
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
