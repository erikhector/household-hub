import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { isTimeZone, TIME_ZONE_COOKIE } from "@/lib/time-zone";

/** The visitor's time zone from its cookie, or UTC before it has been set. */
export const getTimeZone = cache(async (): Promise<string> => {
  const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  return isTimeZone(value) ? value : "UTC";
});
