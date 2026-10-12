"use client";

// Shared show/hide toggle for every password field in the auth flow (login,
// signup, join-signup, reset password) — a plain `<Input type="password">`
// gives no way to check what you typed before submitting, which is
// especially rough on mobile keyboards. Kept local to src/components/auth/
// rather than folded into components/ui/input.tsx since the toggle button,
// aria-labels and icon slot are specific to this app's password fields.

import { useState, type ComponentProps, type ComponentType } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PasswordInput({
  icon: Icon,
  className,
  showLabel,
  hideLabel,
  ...props
}: ComponentProps<typeof Input> & {
  /** Optional left-aligned icon (matches the Mail/Lock icons already used
   * next to the other fields on this form) — omitted where the surrounding
   * form doesn't use field icons (e.g. the join-signup form). */
  icon?: ComponentType<{ className?: string }>;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      {Icon && (
        <Icon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      )}
      <Input
        type={visible ? "text" : "password"}
        className={cn(Icon && "pl-8", "pr-8 max-sm:pr-11 pointer-coarse:pr-11", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 max-sm:right-0 max-sm:p-3.5 pointer-coarse:right-0 pointer-coarse:p-3.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
