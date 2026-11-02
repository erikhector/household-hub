"use client";

import { useEffect, useRef } from "react";
import { BrandBadge } from "@/components/brand/brand-badge";
import { exitWhenIntroDone } from "@/lib/pwa-splash";

// Chrome/Android already generate a native splash screen from manifest.ts
// (icon + name + background_color) with no work needed here. iOS Safari has
// no equivalent — a standalone launch there just shows a blank screen until
// hydration. This fills that gap with a CSS overlay (see the
// `.pwa-splash-*` rules in globals.css): gated behind the
// `display-mode: standalone` media query, which iOS Safari has honored since
// 12.2 (the same signal InstallAppCard already trusts for iOS), so it never
// touches regular browser tabs and needs no JS to avoid a hydration flash.
// Colors are hardcoded to match manifest.ts's background_color/theme_color
// exactly, rather than the theme's light/dark CSS vars, so it hands off
// cleanly from the native Android splash regardless of the visitor's theme.
// The root layout doesn't remount on client-side navigation, so this only
// ever plays once per cold launch, not on every route change.
//
// The animation is all CSS, so it plays before React loads: the badge starts
// where Android's splash left it, hops once, the wordmark rises in as it
// lands, then a circle opens from the middle onto the app. The exit waits
// for a fixed cap so the splash always leaves even without JavaScript; the
// effect below starts it as soon as the app has hydrated and the intro is
// done (src/lib/pwa-splash.ts). In a browser tab the overlay is
// `display: none`, has no animations, and the effect does nothing.
export function PwaSplashScreen() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const splash = ref.current;
    if (!splash) return;
    void exitWhenIntroDone(splash.getAnimations({ subtree: true }) as CSSAnimation[]);
  }, []);

  return (
    <div ref={ref} className="pwa-splash-screen" aria-hidden="true">
      <span className="pwa-splash-mark">
        <span className="pwa-splash-glow" />
        <BrandBadge className="pwa-splash-badge size-20 rounded-3xl" />
      </span>
      <span className="pwa-splash-word font-heading text-2xl font-bold tracking-tight text-white">Squirrel</span>
    </div>
  );
}
