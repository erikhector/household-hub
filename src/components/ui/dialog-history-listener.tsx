"use client";

// Rendered once in the root layout, only so dialog-history.ts is part of
// the first page load on every route: importing it installs its popstate
// listener, which has to be added before Next.js's router adds its own
// (see the comment at the top of dialog-history.ts). Renders nothing.
import "@/components/ui/dialog-history";

export function DialogHistoryListener() {
  return null;
}
