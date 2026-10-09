import type { Metadata, Viewport } from "next";
import { Nunito, Baloo_2, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { getDictionary, getLocale } from "@/lib/i18n/get-dictionary";
import { getUserPreferences } from "@/lib/preferences";
import { isThemeChoice } from "@/components/theme/theme-choice";
import { PwaSplashScreen } from "@/components/pwa/pwa-splash-screen";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { BrowserFloorNotice } from "@/components/pwa/browser-floor-notice";
import { CookieNotice } from "@/components/legal/cookie-notice";
import { DialogHistoryListener } from "@/components/ui/dialog-history-listener";
import { COOKIE_NOTICE_COOKIE } from "@/lib/cookie-inventory";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Squirrel",
  description: "Inventory, shopping, meal planning, and budgeting for your household.",
  // manifest.ts's "display": "standalone" is enough for Chrome/Android, but
  // pre-16.4 iOS only launches Add to Home Screen as standalone (rather than
  // opening in Safari's normal chrome) when this legacy meta tag is present
  // — without it, `display-mode: standalone` never matches there and
  // PwaSplashScreen never gets a chance to show.
  //
  // statusBarStyle is "black" (opaque), not "black-translucent": with
  // translucent, iOS 26 WebKit sizes the standalone WebView to screen height
  // *minus the top safe-area inset* while still anchoring it at the top, so
  // 100dvh, innerHeight and every `position: fixed; bottom: 0` element end
  // up that many pixels short of the physical bottom edge. That's what
  // left BottomNav floating above the home indicator with the page
  // draggable underneath, and no amount of safe-area padding on the nav
  // itself could fix it (see bottom-nav.tsx's git history). Opaque makes
  // WebKit lay the WebView out below the status bar, so the viewport's
  // bottom is the real screen bottom again. iOS freezes these apple-*
  // tags at install time, so an already-installed PWA must be removed and
  // re-added to the Home Screen to pick this up.
  appleWebApp: {
    capable: true,
    title: "Squirrel",
    statusBarStyle: "black",
  },
};

// Next.js doesn't inject a default viewport meta tag — without this, phones
// fall back to a ~980px desktop-sized layout viewport and zoom the whole
// page out to fit, which silently defeats every `sm:` breakpoint in the app.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Without this, iOS reserves the notch/Dynamic Island and home-indicator
  // strips itself and never lets content draw there — which also means
  // env(safe-area-inset-*) resolves to 0, so the padding BottomNav and the
  // bottom-sheet Dialog already apply for the home indicator (see
  // bottom-nav.tsx, dialog.tsx) has no effect. "cover" hands that area to us
  // instead, so those existing safe-area paddings actually take over it.
  viewportFit: "cover",
  // UX-12: resize the layout viewport above the on-screen keyboard (Android
  // Chrome) instead of overlaying it, so the fixed bottom sheet rides up
  // with the visible area on its own. iOS Safari ignores this, which is
  // what the --kb-inset hook (keyboard-inset.ts, read by dialog.tsx) is for.
  interactiveWidget: "resizes-content",
  // UX-29: paint the browser chrome (address bar, task switcher) to match the
  // page ground — globals.css's --gradient-end per scheme — instead of the
  // default white/black. manifest.ts's theme_color is the single-colour
  // fallback for contexts without media-query support; it carries the dark
  // value, the app's default theme.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fefcff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0414" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, prefs, dict, cookieStore] = await Promise.all([
    getLocale(),
    getUserPreferences(),
    getDictionary(),
    cookies(),
  ]);
  const cookieNoticeAcknowledged = cookieStore.get(COOKIE_NOTICE_COOKIE)?.value === "1";
  // next-themes still checks its own localStorage first on the client and
  // wins there if present — this only matters for a browser with no stored
  // theme yet (first visit on a new device), where it lets a signed-in
  // user's account preference apply instead of the hardcoded "dark" default.
  const defaultTheme = prefs && isThemeChoice(prefs.theme) ? prefs.theme : "dark";

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${nunito.variable} ${baloo.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PwaSplashScreen />
        <ServiceWorkerRegistration />
        <BrowserFloorNotice dict={dict.browserFloor} />
        <DialogHistoryListener />
        <ThemeProvider attribute="class" defaultTheme={defaultTheme} enableSystem>
          {children}
          <Toaster />
          <CookieNotice dict={dict.cookieNotice} acknowledged={cookieNoticeAcknowledged} />
        </ThemeProvider>
      </body>
    </html>
  );
}
