"use client";

// UX-33: the shared-element morph, a list row's title flying into the
// heading of the detail page it opens. It's a navigation, so React runs it
// as a view transition (the vt-morph class in globals.css); the names below
// are what lets React pair the row's title with the page's. List rows
// themselves move with use-flip-list.ts instead, since they move at tap
// time and React never animates an update that isn't a Transition.

import { ViewTransition, type ReactNode } from "react";
import { useParams } from "next/navigation";

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
