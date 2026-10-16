"use client";

// Three-state install prompt, same logic as the "InstallPrompt" example in
// node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md
// (per AGENTS.md, followed since training data may not match this Next.js
// build): already installed → nothing to do; iOS → manual instructions
// (Safari has no beforeinstallprompt event); everywhere else → a real
// install button once the browser fires beforeinstallprompt, or generic
// fallback copy before/if it never does.

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAppleMobile } from "@/lib/platform";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Read via useSyncExternalStore rather than useState+useEffect: both are
// browser-only values that would otherwise mismatch between the server-
// rendered HTML and the client's first hydration pass (see React's docs on
// "Cannot call impure function during render" / subscribing to external
// browser APIs). getServerSnapshot below is what SSR/hydration renders;
// the real value replaces it right after.
function subscribeToDisplayMode(onChange: () => void) {
  const mql = window.matchMedia("(display-mode: standalone)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getStandaloneSnapshot = () => window.matchMedia("(display-mode: standalone)").matches;
const getStandaloneServerSnapshot = () => false;

// Static for the life of the page — no real subscription needed, just an
// SSR-safe read of the navigator identity. Covers desktop-mode iPadOS too:
// since iPadOS 13 an iPad reports a Mac UA by default, so the platform +
// touch check in isAppleMobile is what catches it (UX-29).
const noSubscription = () => () => {};
const getIsIOSSnapshot = () =>
  isAppleMobile({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });
const getIsIOSServerSnapshot = () => false;

export function InstallAppCard({ dict }: { dict: Dictionary["profile"]["installApp"] }) {
  const isStandalone = useSyncExternalStore(subscribeToDisplayMode, getStandaloneSnapshot, getStandaloneServerSnapshot);
  const isIOS = useSyncExternalStore(noSubscription, getIsIOSSnapshot, getIsIOSServerSnapshot);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <div className="list-bleed flex flex-col gap-2 rounded-md border p-4">
      <h2 className="font-heading text-base font-semibold">{dict.title}</h2>
      {isStandalone ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="size-4 text-success" />
          {dict.installedDescription}
        </p>
      ) : isIOS ? (
        <p className="text-sm text-muted-foreground">{dict.iosDescription}</p>
      ) : installPrompt ? (
        <Button type="button" onClick={handleInstall} className="self-start">
          <Download className="size-4" />
          {dict.installButton}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">{dict.genericDescription}</p>
      )}
    </div>
  );
}
