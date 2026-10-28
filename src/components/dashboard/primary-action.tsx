import type { ReactNode } from "react";

// The page's one primary action ("Add item", "Add task", "Add transaction",
// "Invite member", "New list"). UX-40, DESIGN.md M2: on a phone it floats at
// the bottom right, just above the bottom bar and the safe area, so a thumb
// reaches it on every page in the same place instead of in a top corner. From
// `sm` it stays exactly where the page put it.
//
// It wraps the page's own trigger (a Button, usually a DialogTrigger) rather
// than drawing one, so each feature keeps its dialog and label; the
// descendant selectors only reshape that button into a 48 px pill on phones
// (or a link styled as one, UX-50: Cook now's empty state points at another
// tab or page).
// `data-primary-action` is what the dashboard <main> looks for (`has-[…]`,
// layout.tsx) to add room at the end of the page, so the button never sits
// over the last row for good.
//
// No "use client": it's plain markup, usable from Server and Client
// Components alike.
export function PrimaryAction({ children }: { children: ReactNode }) {
  return (
    <div
      data-primary-action=""
      // max-w + whitespace-normal + min-h: a long Swedish label at 200% text
      // wraps inside the screen instead of running off its left edge.
      className="max-sm:fixed max-sm:right-[max(1rem,env(safe-area-inset-right))] max-sm:bottom-[calc(var(--bottom-nav-h)+0.75rem+var(--cookie-notice-h,0px))] max-sm:z-30 max-sm:max-w-[calc(100vw-2rem)] max-sm:[&_:is(button,a)]:h-auto max-sm:[&_:is(button,a)]:min-h-12 max-sm:[&_:is(button,a)]:max-w-full max-sm:[&_:is(button,a)]:rounded-full max-sm:[&_:is(button,a)]:px-5 max-sm:[&_:is(button,a)]:whitespace-normal print:hidden"
    >
      {children}
    </div>
  );
}
