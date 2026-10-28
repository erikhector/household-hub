import { createLazyDialogLoader } from "@/components/ui/lazy-dialog";

// PERF-25: the shopping list page's dialogs, loaded on first use. One loader
// per dialog, shared by the host that mounts it and any opener that wants to
// warm its chunk (see components/ui/lazy-dialog.tsx). Kept in one module so
// the import() paths are in a single place and out of the page's own chunk.

export const loadShoppingItemFormDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/shopping-item-form-dialog").then((m) => m.ShoppingItemFormDialog),
);
export const loadReceiptScanDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/receipt-scan-dialog").then((m) => m.ReceiptScanDialog),
);
export const loadPutAwayDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/put-away-dialog").then((m) => m.PutAwayDialog),
);
export const loadImportListDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/import-list-dialog").then((m) => m.ImportListDialog),
);
export const loadResolveMappingsDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/resolve-mappings-dialog").then((m) => m.ResolveMappingsDialog),
);
export const loadReorderSectionsDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/reorder-sections-dialog").then((m) => m.ReorderSectionsDialog),
);
export const loadRenameListDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/rename-list-dialog").then((m) => m.RenameListDialog),
);
export const loadSaveTemplateDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/list-templates").then((m) => m.SaveTemplateDialog),
);
export const loadPartialPriceDialog = createLazyDialogLoader(() =>
  import("@/components/shopping/partial-price-dialog").then((m) => m.PartialPriceDialog),
);
