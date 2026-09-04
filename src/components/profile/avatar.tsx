import { cn } from "cn";

// Deterministic, initials-based avatar — no upload, no stored image. The
// background color is picked from the existing --chart-1..5 tokens by
// hashing a stable seed (the user id, not the display name, so the color
// doesn't shift every time someone edits their name), and the initials are
// derived from the current display name. See REQUIREMENTS.md's "Profile"
// section for why this was chosen over real file upload for this pass.
const AVATAR_BACKGROUNDS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export function UserAvatar({
  displayName,
  seed,
  className,
}: {
  displayName: string;
  /** Stable identifier used only to pick a color — the user id, not the display name. */
  seed: string;
  className?: string;
}) {
  const background = AVATAR_BACKGROUNDS[hashSeed(seed) % AVATAR_BACKGROUNDS.length];

  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex size-16 shrink-0 items-center justify-center rounded-full font-heading text-xl font-semibold text-white",
        background,
        className,
      )}
    >
      {getInitials(displayName)}
    </div>
  );
}
