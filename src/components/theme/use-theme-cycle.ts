"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";

const order = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof order)[number];

const icons: Record<ThemeChoice, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };

export function useThemeCycle() {
  const { theme, setTheme } = useTheme();
  const current: ThemeChoice = order.includes(theme as ThemeChoice)
    ? (theme as ThemeChoice)
    : "system";

  function cycle() {
    const next = order[(order.indexOf(current) + 1) % order.length];
    setTheme(next);
  }

  return { current, Icon: icons[current], cycle };
}
