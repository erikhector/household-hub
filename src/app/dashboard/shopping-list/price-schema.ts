// MAINT-3: the zod schema for a typed price, shared by
// updateShoppingListItemPriceAction (item-actions.ts) and the amount override
// on completeShoppingListAction (list-actions.ts). A plain module because a
// "use server" file can't export a schema.

import { z } from "zod";
import { v } from "@/lib/actions/errors";

export const updateItemPriceSchema = z.object({
  price: z.coerce.number().min(0, v("priceNegative")).max(1_000_000, v("priceTooLarge")),
});
