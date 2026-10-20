"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Monitor, Moon, Sun } from "lucide-react";
import { setLocaleAction } from "@/lib/actions/locale";
import { THEME_CHOICES } from "@/components/theme/theme-choice";
import { useThemeCycle } from "@/components/theme/use-theme-cycle";
import { locales, type Locale } from "@/lib/i18n/locales";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

const themeIcons = { light: Sun, dark: Moon, system: Monitor } as const;

// UX-51: the Profile's Language and Appearance settings. Native radios in a
// fieldset (so arrow keys, the group name and the checked state come for
// free) drawn as a segmented control; the radio itself is visually hidden and
// the label is the 44 px target (DESIGN.md M3). The menu/sidebar shortcuts
// still cycle; these name every option and show the current one.
function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-2 rounded-lg bg-muted p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors has-[:checked]:bg-background has-[:checked]:text-foreground has-[:checked]:shadow-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PreferencesControls({
  locale,
  theme,
  language,
}: {
  locale: Locale;
  theme: Dictionary["theme"];
  language: Dictionary["language"];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { current, select } = useThemeCycle();

  function selectLocale(next: Locale) {
    if (next === locale) return;
    startTransition(() => {
      setLocaleAction(next).then(() => router.refresh());
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        legend={language.heading}
        name="locale"
        value={locale}
        disabled={isPending}
        onChange={selectLocale}
        options={locales.map((l) => ({
          value: l,
          label: l === "sv" ? language.swedish : language.english,
        }))}
      />
      <Segmented
        legend={theme.heading}
        name="theme"
        value={current}
        onChange={select}
        options={THEME_CHOICES.map((choice) => {
          const Icon = themeIcons[choice];
          return { value: choice, label: theme[choice], icon: <Icon className="size-4" aria-hidden /> };
        })}
      />
    </div>
  );
}
