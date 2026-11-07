"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { isShortcutPath, isTypingTarget, moveIndex, shortcutFor } from "@/components/dashboard/keyboard-shortcuts-logic";

// UX-41c: single-key shortcuts on the list pages (shopping, inventory,
// tasks), mounted once in the dashboard layout beside the command palette.
//
//   n  new          clicks (or, for a text field, focuses) [data-shortcut="new"]
//   /  search       focuses [data-shortcut="search"]
//   j  next row     moves the highlight down  [data-shortcut-row]
//   k  previous row moves the highlight up
//   x  tick         clicks the highlighted row's checkbox
//   ?  this overlay
//
// The page owns what each key means by marking its own controls with those
// data attributes, so this file knows nothing about shopping, tasks or
// inventory and a page without a search box simply has no `/`. The keys are
// ignored while typing in a field, with any dialog or menu open, with a
// modifier held (Ctrl+K is the command palette) and on a touch-first device,
// where there is no keyboard to press them on. A convenience for people at a
// desk, never the only way to anything (DESIGN.md M7): every key is also a
// visible button, field or checkbox. It stores nothing in the browser.

const ROW_SELECTOR = "[data-shortcut-row]";
const ACTIVE_ATTR = "data-shortcut-active";

function visible(el: HTMLElement) {
  return el.getClientRects().length > 0;
}

function visibleRows() {
  return Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(visible);
}

function findTarget(name: "new" | "search") {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-shortcut="${name}"]`)).find(
    (el) => visible(el) && !(el as HTMLButtonElement).disabled,
  );
}

function clearActive() {
  document.querySelectorAll(`[${ACTIVE_ATTR}]`).forEach((el) => el.removeAttribute(ACTIVE_ATTR));
}

export function KeyboardShortcuts({ dict }: { dict: Dictionary["shortcuts"] }) {
  const pathname = usePathname();
  const enabled = isShortcutPath(pathname);
  const [helpOpen, setHelpOpen] = useState(false);
  // The row last highlighted, and its index for when that row is re-rendered
  // away (a ticked shopping item moves to "In the cart").
  const activeRef = useRef<{ el: HTMLElement | null; index: number }>({ el: null, index: -1 });

  useEffect(() => {
    if (!enabled) return;
    // Arriving on a page starts with nothing highlighted.
    activeRef.current = { el: null, index: -1 };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const action = shortcutFor(event);
      if (!action) return;
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      if (isTypingTarget(event.target)) return;
      // Any open dialog (the palette and this overlay included) or menu owns
      // the keyboard. Base UI unmounts them when closed.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;

      if (action === "help") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (action === "new" || action === "search") {
        const el = findTarget(action);
        if (!el) return;
        // Without this the key would be typed into the field it just focused.
        event.preventDefault();
        if (action === "new" && !(el instanceof HTMLInputElement)) el.click();
        else el.focus();
        return;
      }

      const rows = visibleRows();
      const active = activeRef.current;
      let index = active.el ? rows.indexOf(active.el) : -1;
      if (index < 0 && active.index >= 0) index = Math.min(active.index, rows.length - 1);

      if (action === "tick") {
        const row = rows[index];
        if (!row) return;
        event.preventDefault();
        row.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
        return;
      }

      const next = moveIndex(index, rows.length, action);
      if (next < 0) return;
      event.preventDefault();
      clearActive();
      const row = rows[next];
      row.setAttribute(ACTIVE_ATTR, "");
      row.scrollIntoView({ block: "nearest" });
      activeRef.current = { el: row, index: next };
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearActive();
    };
  }, [enabled, pathname]);

  if (!enabled) return null;

  const keys: { key: string; label: string }[] = [
    { key: "n", label: dict.new },
    { key: "/", label: dict.search },
    { key: "j", label: dict.next },
    { key: "k", label: dict.previous },
    { key: "x", label: dict.tick },
    { key: "?", label: dict.help },
  ];

  return (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogTitle>{dict.title}</DialogTitle>
        <DialogDescription>{dict.description}</DialogDescription>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {keys.map(({ key, label }) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs">
                  {key}
                </kbd>
              </dt>
              <dd className="text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
