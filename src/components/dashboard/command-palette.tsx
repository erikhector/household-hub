"use client";

import { useEffect, useRef, useState } from "react";
import { LazyDialog } from "@/components/ui/lazy-dialog";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { isPaletteShortcut } from "@/components/dashboard/command-palette-commands";
import { loadCommandPaletteDialog } from "@/components/dashboard/lazy-shell";

// UX-41a: ⌘K / Ctrl+K opens a command palette, mounted once in the
// dashboard layout. The palette itself (command-palette-dialog.tsx) is loaded
// on first use (PERF-27): this file is only the shortcut listener and the
// `open` state, so every dashboard page carries a few lines instead of the
// dialog. The chunk is fetched in idle time after hydration (LazyDialog), so
// the first press is normally as quick as before; a press that beats it opens
// the palette the moment the chunk arrives.
export function CommandPalette({ dict, nav }: { dict: Dictionary["commandPalette"]; nav: Dictionary["nav"] }) {
  const [open, setOpen] = useState(false);

  // The shortcut listener is installed once, so it reads the latest state
  // through a ref instead of re-subscribing on every change.
  const toggleRef = useRef(() => {});
  useEffect(() => {
    toggleRef.current = () => setOpen(!open);
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    // A failed chunk load closes the request (the toast says why), so the
    // next press retries.
    <LazyDialog loader={loadCommandPaletteDialog} open={open} onLoadError={() => setOpen(false)}>
      {(Palette) => <Palette dict={dict} nav={nav} open={open} onOpenChange={setOpen} />}
    </LazyDialog>
  );
}
