"use client";

// UX-33: the app's two reusable view transitions. The animations
// themselves are CSS (the vt-* classes in globals.css); these only say
// which element is which, so React can pair them up across a commit.
//
// React animates a <ViewTransition> only on updates that run inside a
// Transition: a navigation, a Server Action's result, a Suspense reveal.
// The optimistic tick (UX-14) is a sync update, so the checkbox still flips
// at once, and the row's move into "Done" plays when the server's answer
// lands.

import { ViewTransition, type ReactNode } from "react";
import { useParams } from "next/navigation";

/**
 * One row of a list that changes in place (shopping items, tasks,
 * inventory). A new row rises in, a deleted one fades out, and rows that
 * shift because of either glide to their new place instead of jumping
 * (quickly: a row can't be tapped while it animates, see globals.css).
 *
 * `name` must be unique on the page and stable for the row (prefix + id).
 * Because it's a name rather than a position, a row that leaves one
 * section and appears in another in the same commit (ticked into
 * "Purchased"/"Completed") is treated as one element that moved, not a
 * delete plus an add.
 *
 * `default="none"` keeps unrelated transitions (a page change, a morph
 * elsewhere) from touching the row.
 *
 * Section labels in the list ("Purchased", a category) use it too, without
 * a name, so they glide along with the rows instead of jumping while the
 * rows around them move. React names those itself; a label never needs to
 * pair with one elsewhere.
 */
export function ListRowTransition({ name, children }: { name?: string; children: ReactNode }) {
  return (
    <ViewTransition
      name={name}
      enter="vt-row-enter"
      exit="vt-row-exit"
      share="vt-row-move"
      update="vt-row-shift"
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/**
 * Wraps a list built from ListRowTransition rows. When a whole page goes
 * (a navigation to a list's detail page, or back), React animates only the
 * outermost <ViewTransition>s in what left and what arrived. Without this
 * boundary those are the rows themselves, and every row would fade out on
 * the way to a detail page. With it, the outermost one is this, which does
 * nothing: the rows only animate when the list itself changes. Named pairs
 * inside it (a row's MorphTitle) still find each other.
 */
export function ListTransitionScope({ children }: { children: ReactNode }) {
  return <ViewTransition default="none">{children}</ViewTransition>;
}

/**
 * Something outside the list whose layout changes with it (the shopping
 * list's header buttons, which gain "Put away" when an item is ticked).
 * It glides like a shifted row, and only then: no enter or exit, so it
 * never fades in or out with the page.
 */
export function ShiftTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition update="vt-row-shift" default="none">
      {children}
    </ViewTransition>
  );
}

/** The shared names a list row and its detail page agree on. */
export type MorphKind = "shopping-list" | "inventory-item";

export function morphName(kind: MorphKind, id: string) {
  return `${kind}-${id}`;
}

/**
 * The title that carries over from a list row to the detail page it opens
 * (and back). Wrap the row's title and the page's `h1` with the same kind
 * and id. Both need `share` set explicitly: with `default="none"` and no
 * `share`, React silently stops pairing them.
 */
export function MorphTitle({ kind, id, children }: { kind: MorphKind; id: string; children: ReactNode }) {
  return (
    <ViewTransition name={morphName(kind, id)} share="vt-morph" default="none">
      {children}
    </ViewTransition>
  );
}

/**
 * The same, for a detail page's loading skeleton: the detail routes have a
 * `loading.tsx`, so a navigation usually commits the skeleton first and
 * the page a moment later. The title bar takes the row title's name, so
 * the title flies to the header at once and then hands over to the real
 * `h1` when the page arrives. `loading.tsx` gets no params, hence
 * useParams.
 */
export function MorphTitleSkeleton({ kind, children }: { kind: MorphKind; children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  if (!id) return children;
  return (
    <MorphTitle kind={kind} id={id}>
      {children}
    </MorphTitle>
  );
}
