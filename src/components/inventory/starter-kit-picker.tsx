"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addStarterKitItemsAction } from "@/app/dashboard/inventory/actions";
import { format, plural } from "@/lib/i18n/format";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/get-dictionary";

/**
 * Predefined item checklists a user can add in one action instead of typing
 * each one — the "avoid the empty container" pattern most inventory/pantry
 * apps use for first-run. Kit labels and item names come straight out of
 * the locale dictionary (`dict.starterKits.kits`) rather than being
 * hardcoded here, so every locale gets its own translated set; only the
 * `id`s are shared across locales, used as stable React/selection keys.
 */
export function StarterKitPicker({ dict }: { dict: Dictionary["inventory"] }) {
  const kits = dict.starterKits.kits;
  const [activeId, setActiveId] = useState(kits[0]?.id);
  const active = kits.find((kit) => kit.id === activeId) ?? kits[0];
  const [selected, setSelected] = useState<Set<string>>(new Set(active?.items ?? []));
  const [isPending, startTransition] = useTransition();

  if (!active) return null;

  const switchKit = (id: string) => {
    setActiveId(id);
    const kit = kits.find((k) => k.id === id);
    setSelected(new Set(kit?.items ?? []));
  };

  const toggleItem = (item: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      return next;
    });
  };

  const handleAdd = () => {
    if (selected.size === 0) {
      toast.error(dict.starterKits.noneSelected);
      return;
    }
    startTransition(async () => {
      const result = await addStarterKitItemsAction(active.label, [...selected]);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      const added = result.added ?? 0;
      if (added === 0) {
        toast.success(dict.starterKits.allAlreadyAdded);
        return;
      }
      toast.success(format(plural(added, dict.starterKits.addedToast), { count: added, kit: active.label }));
    });
  };

  return (
    <div className="flex w-full max-w-sm flex-col gap-3">
      <div>
        <p className="text-sm font-medium">{dict.starterKits.heading}</p>
        <p className="text-xs text-muted-foreground">{dict.starterKits.description}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {kits.map((kit) => (
          <Button
            key={kit.id}
            type="button"
            size="sm"
            variant={kit.id === active.id ? "default" : "outline"}
            onClick={() => switchKit(kit.id)}
          >
            {kit.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {active.items.map((item) => {
          const isSelected = selected.has(item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={isSelected}
              onClick={() => toggleItem(item)}
              className={cn(
                // The chip itself stays visually compact (text-xs, tight
                // padding), but the button's own box is padded out to a
                // ~44px tall tappable area — comfortable on touch without
                // making the badge look oversized.
                "inline-flex min-h-11 items-center justify-center rounded-full border px-3 py-1 text-xs transition-colors",
                isSelected
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input text-muted-foreground hover:border-primary/50",
              )}
            >
              {item}
            </button>
          );
        })}
      </div>
      <Button type="button" size="sm" onClick={handleAdd} disabled={isPending}>
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          format(plural(selected.size, dict.starterKits.addSelected), { count: selected.size })
        )}
      </Button>
    </div>
  );
}
