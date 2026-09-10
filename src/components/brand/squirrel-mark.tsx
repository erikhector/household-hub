import type { SVGProps } from "react";

// The app's brand mark: a squirrel curled up with its tail arcing over its
// back — a solid, single-color silhouette (not a lucide-style stroke icon)
// so it reads clearly at both header-badge size and favicon size. Drop in
// anywhere a lucide icon would go; it inherits color via `currentColor`
// exactly the same way (see BrandBadge, which wraps it in the app's
// existing icon-badge treatment).
export function SquirrelMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M5.57,15 A8,8 0 1,1 20.38,9.61 L17.42,10.13 A5,5 0 1,0 8.17,13.5 Z" />
      <ellipse cx="9.5" cy="18.8" rx="6" ry="4.4" />
      <circle cx="16" cy="15.2" r="4.1" />
      <path d="M18.1,12.8 L19.4,9.6 L20.3,13.1 Z" />
    </svg>
  );
}
