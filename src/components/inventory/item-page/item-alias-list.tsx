"use client";

import { useTransition } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { removeItemAliasAction } from "@/app/dashboard/inventory/items/actions";
import type { Dictionary } from "@/lib/i18n/get-dictionary";
import { format } from "@/lib/i18n/format";

// "Names that map here" (MATCH-6, design §6.1): the ItemAlias rows the
// recipe review learned for this item (MATCH-2). Removing one undoes a
// wrong learned match; the next recipe with that name is asked about
// again.
export function ItemAliasList({
  aliases,
  dict,
}: {
  aliases: { id: string; normalizedName: string }[];
  dict: Dictionary["inventory"]["itemPage"];
}) {
  const [isPending, startTransition] = useTransition();
  const handleRemove = (aliasId: string) =>
    startTransition(async () => {
      const result = await removeItemAliasAction(aliasId);
      if (result.error) toast.error(result.error);
    });

  return (
    <section aria-labelledby="aliases" className="flex flex-col gap-2">
      <h2 id="aliases" className="font-heading text-lg font-semibold">
        {dict.aliasesTitle}
      </h2>
      <p className="text-sm text-muted-foreground">{aliases.length === 0 ? dict.noAliases : dict.aliasesHint}</p>
      {aliases.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {aliases.map((alias) => (
            <li key={alias.id} className="flex items-center gap-1 rounded-full border py-0.5 pr-0.5 pl-3 text-sm">
              <span className="break-all">{alias.normalizedName}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-full text-muted-foreground hover:text-destructive"
                disabled={isPending}
                aria-label={format(dict.removeAliasAriaLabel, { name: alias.normalizedName })}
                onClick={() => handleRemove(alias.id)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
