import Image from "next/image";
import { cn } from "@/lib/utils";
import icon from "@/app/icon.png";

// The brand mark wherever the wordmark appears (landing header, auth pages,
// legal pages) — the same recolored squirrel mascot used for the favicon/app
// icon, rendered at a size where its detail (face, tail, acorn) still reads
// rather than blurring into a dot.
export function BrandBadge({ className }: { className?: string }) {
  return (
    <span className={cn("relative block size-10 shrink-0 overflow-hidden rounded-xl", className)}>
      <Image src={icon} alt="" fill sizes="40px" className="object-cover" priority />
    </span>
  );
}
