"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { THEME_CHOICES, type ThemeChoice } from "@/components/theme/theme-choice";
import { setThemeAction } from "@/lib/actions/preferences";

const order = THEME_CHOICES;
export type { ThemeChoice };

const icons: Record<ThemeChoice, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

// No-op subscribe: "mounted" never changes after the initial client render,
// so there's nothing to subscribe to — this just needs a stable function
// reference (won't re-subscribe every render) that never fires.
function subscribe() {
  return () => {};
}

export function useThemeCycle() {
  const { theme, setTheme } = useTheme();
  // useSyncExternalStore (not useState+useEffect) is the React-recommended
  // way to get a value that's false during SSR/first client render and true
  // after: getServerSnapshot always returns false, so hydration matches the
  // server markup, while getSnapshot returns true for every client render
  // from then on — no setState-in-effect, no extra render pass.
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  // Server-rendered markup can't know the client's localStorage theme, so
  // report "system" until mounted to keep the first client render in sync
  // with SSR output and avoid a hydration mismatch.
  const current: ThemeChoice =
    mounted && order.includes(theme as ThemeChoice) ? (theme as ThemeChoice) : "system";

  function cycle() {
    const next = order[(order.indexOf(current) + 1) % order.length];
    setTheme(next);
    // Fire-and-forget: persists to the account so other devices pick it up
    // next time they render, but the local next-themes state (and localStorage)
    // already drives this device's UI instantly regardless of the request.
    void setThemeAction(next);
  }

  return { current, Icon: icons[current], cycle };
}
