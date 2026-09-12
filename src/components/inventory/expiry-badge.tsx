"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getExpiryStatus } from "@/lib/inventory/expiry";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

export function ExpiryBadge({ expiresAt, dict }: { expiresAt: Date | null; dict: Dictionary["inventory"] }) {
  // Read once via a lazy initializer rather than calling Date.now() directly
  // in the render body — same pattern InventoryClient's `now` uses for
  // matchesUpdatedFilter.
  const [now] = useState(() => Date.now());
  const status = getExpiryStatus(expiresAt, now);
  if (!status) return null;
  if (status === "expired") return <Badge variant="destructive">{dict.expired}</Badge>;
  return <Badge className="bg-amber-500 text-white">{dict.expiringSoon}</Badge>;
}
