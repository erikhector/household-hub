import { BrandBadge } from "@/components/brand/brand-badge";

// Chrome/Android already generate a native splash screen from manifest.ts
// (icon + name + background_color) with no work needed here. iOS Safari has
// no equivalent — a standalone launch there just shows a blank screen until
// hydration. This fills that gap with a pure-CSS overlay (see the
// `.pwa-splash-screen` rules in globals.css): gated behind the
// `display-mode: standalone` media query, which iOS Safari has honored since
// 12.2 (the same signal InstallAppCard already trusts for iOS), so it never
// touches regular browser tabs and needs no JS to avoid a hydration flash.
// Colors are hardcoded to match manifest.ts's background_color/theme_color
// exactly, rather than the theme's light/dark CSS vars, so it hands off
// cleanly from the native Android splash regardless of the visitor's theme.
// The root layout doesn't remount on client-side navigation, so this only
// ever plays once per cold launch, not on every route change.
export function PwaSplashScreen() {
  return (
    <div className="pwa-splash-screen" aria-hidden="true">
      <BrandBadge className="size-20 rounded-3xl" />
      <span className="font-heading text-2xl font-bold tracking-tight text-white">Squirrel</span>
    </div>
  );
}
