"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";

const order = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof order)[number];

const icons: Record<ThemeChoice, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

export function useThemeCycle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Server-rendered markup can't know the client's localStorage theme, so
  // report "system" until mounted to keep the first client render in sync
  // with SSR output and avoid a hydration mismatch.
  const current: ThemeChoice =
    mounted && order.includes(theme as ThemeChoice) ? (theme as ThemeChoice) : "system";

  function cycle() {
    const next = order[(order.indexOf(current) + 1) % order.length];
    setTheme(next);
  }

  return { current, Icon: icons[current], cycle };
}
