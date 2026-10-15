import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import icon from "@/app/icon.png";

// UX-38: the squirrel mark at empty-state size. The same raster as
// BrandBadge (DESIGN.md "Brand mark": never redrawn or recoloured, on its
// own rounded tile rather than a busy ground), only bigger, so the face and
// acorn still read as the friendly centre of an otherwise blank page. It
// carries real alt text, unlike BrandBadge (which sits beside the word
// "Squirrel"), because here nothing else names it.
export function MascotMark({ alt, className }: { alt: string; className?: string }) {
  return (
    <span className={cn("relative block size-16 shrink-0 overflow-hidden rounded-2xl", className)}>
      <Image src={icon} alt={alt} fill sizes="64px" className="object-cover" />
    </span>
  );
}

// The dashed "nothing here yet" box the feature pages already used, with the
// mascot on top. Callers keep their own copy and pass it as children, so a
// page's wording (and any action under it) stays where it was.
export function MascotEmptyState({
  alt,
  children,
  className,
}: {
  alt: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-md border border-dashed px-4 py-8 text-center sm:p-8",
        className,
      )}
    >
      <MascotMark alt={alt} />
      {children}
    </div>
  );
}
