import { Check } from "lucide-react";
import { BrandBadge } from "@/components/brand/brand-badge";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

type PreviewDict = Dictionary["landing"]["preview"];

// UX-58: the landing page's product shot. A shopping list in a phone frame,
// drawn with the app's own tokens and row styling (checkbox, "Low stock"
// badge, struck-through "Purchased" row, the default list's "Fills itself"
// badge) rather than a screenshot, so it follows the visitor's language and
// theme and never goes stale against a PNG nobody re-shoots. It's a picture,
// not a control: one `role="img"` with a label for screen readers, and
// nothing inside is focusable or tappable.
export function PhonePreview({ dict, className }: { dict: PreviewDict; className?: string }) {
  const sections = [
    {
      title: dict.sections.dairy,
      items: [
        { ...dict.items.oatMilk, lowStock: true },
        { ...dict.items.yogurt, lowStock: false },
      ],
    },
    {
      title: dict.sections.produce,
      items: [
        { ...dict.items.bananas, lowStock: false },
        { ...dict.items.spinach, lowStock: false },
      ],
    },
    {
      title: dict.sections.pantry,
      items: [{ ...dict.items.pasta, lowStock: true }],
    },
  ];

  return (
    <div
      role="img"
      aria-label={dict.label}
      className={cn(
        "w-72 max-w-full shrink-0 rounded-4xl bg-muted p-2.5 ring-1 ring-foreground/10 select-none",
        className,
      )}
    >
      <div className="flex flex-col gap-3 overflow-hidden rounded-3xl bg-background px-3 pt-2 pb-4 text-left">
        {/* The speaker slot, so the frame reads as a phone at a glance. */}
        <span className="mx-auto h-1.5 w-14 rounded-full bg-foreground/15" />
        <div className="flex items-center gap-2">
          <BrandBadge className="size-8 rounded-lg" />
          <span className="min-w-0 flex-1 font-heading text-base leading-tight font-bold break-words">
            {dict.listName}
          </span>
          <span className={badgeVariants({ variant: "secondary" })}>{dict.fillsItself}</span>
        </div>
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-1">
            <span className="px-1 text-xs font-semibold text-muted-foreground">{section.title}</span>
            <div className="flex flex-col rounded-xl bg-card px-3 py-1 ring-1 ring-foreground/10">
              {section.items.map((item) => (
                <div key={item.name} className="flex items-center gap-2.5 py-1.5 text-sm">
                  <span className="size-4 shrink-0 rounded-[5px] border border-input" />
                  <span className="min-w-0 flex-1 truncate">
                    {item.name}
                    <span className="text-muted-foreground"> · {item.qty}</span>
                  </span>
                  {item.lowStock && (
                    <span className={badgeVariants({ variant: "secondary" })}>{dict.lowStock}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <span className="px-1 text-xs font-semibold text-muted-foreground">{dict.purchased}</span>
          <div className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 text-sm ring-1 ring-foreground/10">
            <span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
              <Check className="size-3" strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">
              {dict.items.coffee.name}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
