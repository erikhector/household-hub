// UX-72: pure helpers behind the overview greeting. The server runs in UTC
// and doesn't know the user's zone, so the hour is read in the browser
// (components/dashboard/greeting.tsx) and only the bucketing lives here.

export type GreetingKey = "morning" | "afternoon" | "evening";

/** Bucket a local hour (0-23) into the part of the day. */
export function greetingKey(hour: number): GreetingKey {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/**
 * The first word of a display name ("Åsa Lindström" -> "Åsa"). The greeting is
 * a 30 px heading, where a full name wraps and reads as formal. Falls back to
 * the whole trimmed name when there is nothing to split.
 */
export function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  return trimmed.split(/\s+/)[0] || trimmed;
}
