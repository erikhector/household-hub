import { cn } from "@/lib/utils";
import { SquirrelMark } from "@/components/brand/squirrel-mark";

// The small colored badge that wraps the brand mark wherever the wordmark
// appears (landing header, auth pages, legal pages) — extracted once these
// were the same six lines of markup repeated in six files.
export function BrandBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 items-center justify-center rounded-xl bg-primary/15 text-primary",
        className,
      )}
    >
      <SquirrelMark className="size-4" />
    </span>
  );
}
