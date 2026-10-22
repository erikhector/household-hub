import type { ReactNode } from "react";

// UX-59: an inline error under its field. `role="alert"` makes a screen
// reader announce it when it appears, and the field points at it with
// `aria-describedby={fieldErrorId(id)}` plus `aria-invalid`.
export function fieldErrorId(fieldId: string) {
  return `${fieldId}-error`;
}

export function FieldError({ fieldId, children }: { fieldId: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={fieldErrorId(fieldId)} role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
