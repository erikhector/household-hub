"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// A submit button for a plain `<form action={serverAction}>` rendered by a
// Server Component (the getting-started card's "Skip" and "Hide"), so the
// tap still shows it's working (DESIGN.md M5) without turning the whole
// card into a Client Component: useFormStatus reads the parent form's
// pending state. The spinner replaces an icon button's icon, and sits in
// front of a text button's label so the label doesn't vanish mid-tap.
export function PendingSubmitButton({ children, ...props }: Omit<ComponentProps<typeof Button>, "type">) {
  const { pending } = useFormStatus();
  const iconOnly = props.size?.startsWith("icon") ?? false;
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" />}
      {pending && iconOnly ? null : children}
    </Button>
  );
}
