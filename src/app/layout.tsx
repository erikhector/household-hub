import type { Metadata, Viewport } from "next";
import { Nunito, Baloo_2, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { getLocale } from "@/lib/i18n/get-dictionary";
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
};

// Next.js doesn't inject a default viewport meta tag — without this, phones
// fall back to a ~980px desktop-sized layout viewport and zoom the whole
// page out to fit, which silently defeats every `sm:` breakpoint in the app.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${nunito.variable} ${baloo.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
