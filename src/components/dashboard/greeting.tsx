"use client";

import { useSyncExternalStore } from "react";
import { format } from "@/lib/i18n/format";
import { greetingKey } from "@/lib/greeting";

const subscribeNoop = () => () => {};

// UX-72: "Good morning" by the clock on the user's own device. The server
// runs in UTC and has no idea where the user is, so a Stockholm user got
// "Good morning" at 13:00. The server render and hydration use the neutral
// `hello` line (it can't be wrong in any zone), and the real greeting
// replaces it right after, the same trick PageTitle uses for its portal slot.
// It doesn't tick, so a tab left open overnight updates on the next
// navigation, which is fine for a heading.
export function Greeting({
  name,
  dict,
}: {
  name: string;
  dict: { hello: string; morning: string; afternoon: string; evening: string };
}) {
  const key = useSyncExternalStore(
    subscribeNoop,
    () => greetingKey(new Date().getHours()),
    () => null,
  );
  return <>{format(key ? dict[key] : dict.hello, { name })}</>;
}
