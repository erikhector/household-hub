import { getDictionary } from "@/lib/i18n/get-dictionary";
import { MorphTitleSkeleton, type MorphKind } from "@/components/shared/view-transitions";

// UX-42: shared shape for the per-route `loading.tsx` files. The header
// block matches the real pages (an `h1` at text-2xl is 2rem tall, the
// subtitle line below it 1.25rem) and each body variant uses fixed heights
// close to the content it stands in for, so the swap from skeleton to page
// moves as little as possible. Heights are fixed on purpose: a skeleton
// that sizes itself to its content would shift exactly when the content
// arrives.
export type PageSkeletonVariant = "cards" | "rows" | "table" | "narrow";

function Body({ variant }: { variant: PageSkeletonVariant }) {
  switch (variant) {
    case "cards":
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-lg border bg-muted/40" />
          ))}
        </div>
      );
    case "rows":
      return (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded-md border bg-muted/40" />
          ))}
        </div>
      );
    case "table":
      return (
        <div className="flex flex-col gap-3">
          <div className="h-11 rounded-md border bg-muted/40" />
          <div className="flex flex-col gap-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 rounded-md bg-muted/40" />
            ))}
          </div>
        </div>
      );
    case "narrow":
      return (
        <div className="flex max-w-md flex-col gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 rounded-md border bg-muted/40" />
          ))}
        </div>
      );
  }
}

// `back` adds the "← Back" link row the detail pages (a shopping list, an
// inventory item, the item catalogue) carry above their title, so those
// don't render a skeleton that sits a link's height too high.
//
// `morph` (UX-33) is for a detail page whose list row's title morphs into
// its heading: the title bar takes the row's name, so the morph starts as
// soon as the skeleton shows (see MorphTitleSkeleton).
export async function PageSkeleton({
  variant,
  back = false,
  morph,
}: {
  variant: PageSkeletonVariant;
  back?: boolean;
  morph?: MorphKind;
}) {
  const dict = await getDictionary();
  const title = <div className="h-8 w-48 rounded-md bg-muted" />;
  return (
    <div className="flex animate-pulse flex-col gap-6" role="status" aria-label={dict.common.loading}>
      <div className="flex flex-col gap-1">
        {back && <div className="h-5 w-24 rounded-md bg-muted/60" />}
        {morph ? <MorphTitleSkeleton kind={morph}>{title}</MorphTitleSkeleton> : title}
        <div className="h-5 w-64 max-w-full rounded-md bg-muted/60" />
      </div>
      <Body variant={variant} />
    </div>
  );
}
