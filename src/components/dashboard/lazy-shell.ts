import { createLazyDialogLoader } from "@/components/ui/lazy-dialog";

// PERF-27: the dashboard shell's popups, loaded on first use. They hydrate on
// every page but only appear after a tap or ⌘K. One loader per popup, shared
// by the host that mounts it and any opener that wants to warm its chunk (see
// components/ui/lazy-dialog.tsx), and kept in one module so the import()
// paths stay out of the shell's own chunk.

export const loadCommandPaletteDialog = createLazyDialogLoader(() =>
  import("@/components/dashboard/command-palette-dialog").then((m) => m.CommandPaletteDialog),
);
export const loadHouseholdSwitcherMenu = createLazyDialogLoader(() =>
  import("@/components/household/household-switcher-menu").then((m) => m.HouseholdSwitcherMenu),
);
export const loadBottomNavMoreMenu = createLazyDialogLoader(() =>
  import("@/components/dashboard/bottom-nav-more-menu").then((m) => m.BottomNavMoreMenu),
);
