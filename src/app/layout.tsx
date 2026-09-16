import type { Metadata, Viewport } from "next";
import { Nunito, Baloo_2, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { getLocale } from "@/lib/i18n/get-dictionary";
import { getUserPreferences } from "@/lib/preferences";
import { isThemeChoice } from "@/components/theme/theme-choice";
import { PwaSplashScreen } from "@/components/pwa/pwa-splash-screen";
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
  appleWebApp: {
    capable: true,
    title: "Squirrel",
    statusBarStyle: "black-translucent",
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
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [locale, prefs] = await Promise.all([getLocale(), getUserPreferences()]);
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
        <ThemeProvider attribute="class" defaultTheme={defaultTheme} enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
