"use client";

// Registers src/lib/service-worker.js from the root layout, so every visit
// gets a service worker — not just the ones that happen to open Profile's
// Push Notifications card (see push-notifications-card.tsx, which also
// registers it, for the push-subscription flow specifically). Before this,
// someone who installed the PWA straight from the browser's native "Install
// app" prompt (see install-app-card.tsx) and never visited that card got no
// service worker at all, which meant no offline fallback page either (see
// service-worker.js's own doc comment) — UX_AUDIT_IMPLEMENTATION_PLAN.md's
// G3. Registration is idempotent — the browser returns the existing
// registration for the same script URL + scope rather than creating a
// second one, so this and push-notifications-card.tsx's own call never
// conflict.
//
// No UI, no return value: this is pure registration side-effect, same
// "invisible top-level client component" shape as PwaSplashScreen.

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register(new URL("../../lib/service-worker.js", import.meta.url), { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Best-effort — a failed registration here just means no offline
        // fallback / no push later; nothing in the rest of the app depends
        // on it synchronously.
      });
  }, []);

  return null;
}
