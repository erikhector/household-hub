import { createLazyDialogLoader } from "@/components/ui/lazy-dialog";

// PERF-26: the inventory page group's dialogs, loaded on first use with the
// lazy-dialog helper (components/ui/lazy-dialog.tsx). One loader per dialog,
// shared by the host that mounts it and any opener that wants to warm its
// chunk, and kept in one module so the import() paths are in a single place
// and out of the page's own chunk.

export const loadStockScanDialog = createLazyDialogLoader(() =>
  import("@/components/inventory/stock-scan-dialog").then((m) => m.StockScanDialog),
);
export const loadBulkPasteDialog = createLazyDialogLoader(() =>
  import("@/components/inventory/bulk-paste-dialog").then((m) => m.BulkPasteDialog),
);
export const loadBulkScanDialog = createLazyDialogLoader(() =>
  import("@/components/inventory/bulk-scan-dialog").then((m) => m.BulkScanDialog),
);
export const loadAiShelfScanDialog = createLazyDialogLoader(() =>
  import("@/components/inventory/ai-shelf-scan-dialog").then((m) => m.AiShelfScanDialog),
);
export const loadItemFormDialog = createLazyDialogLoader(() =>
  import("@/components/inventory/add-item-dialog").then((m) => m.ItemFormDialog),
);
export const loadChangeUnitDialog = createLazyDialogLoader(() =>
  import("@/components/inventory/item-page/change-unit-dialog").then((m) => m.ChangeUnitDialog),
);
export const loadMergeIntoDialog = createLazyDialogLoader(() =>
  import("@/components/inventory/catalog/merge-into-dialog").then((m) => m.MergeIntoDialog),
);
