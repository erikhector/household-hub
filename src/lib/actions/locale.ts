"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/locales";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;

  // Cookie is set for every caller (including anonymous — see getLocale()'s
  // fallback), so pre-auth pages like /login keep working exactly as before.
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
  });

  // Also persist to the account when signed in, so the choice follows the
  // user to other devices — see src/lib/preferences.ts's getUserPreferences,
  // which getLocale() prefers over this cookie for a logged-in request.
  const session = await auth();
  if (session?.user?.id) {
    try {
      await prisma.user.update({ where: { id: session.user.id }, data: { locale } });
    } catch (error) {
      logger.error("Failed to persist locale preference", { error });
    }
  }

  revalidatePath("/", "layout");
}
