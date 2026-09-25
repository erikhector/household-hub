import { NextResponse, type NextRequest } from "next/server";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSessionRevoked, SESSION_EXPIRED_LOGIN_PATH } from "@/lib/session-revocation";

// SCALE-H: where requireHousehold/requireUserId (src/lib/session.ts) send a
// session that was revoked by a password change. It exists because they
// can't just redirect("/login"): the revoked JWT cookie is still present,
// so proxy.ts would treat the request as logged in and bounce /login back
// to /dashboard, which would bounce back to /login, forever. Clearing the
// cookie has to happen somewhere cookies can be written — a Server
// Component render can't — hence a Route Handler.
//
// Deliberately NOT a general-purpose "GET to log out" endpoint: it
// re-checks revocation itself and does nothing to a still-valid session,
// so a third-party page embedding <img src="/session-expired"> can't sign
// anyone out (logout stays a POST Server Action, logoutAction). It lives
// outside /dashboard so proxy.ts's logged-out gate never touches it, and
// outside /login//signup so its logged-in redirect doesn't either.
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    // Already signed out (e.g. a second tab got here first).
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordChangedAt: true },
  });

  if (!isSessionRevoked(user, session.user.pwdChangedAt)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // signOut clears the session cookie(s) and throws Next's redirect, which
  // must propagate — no try/catch here (see AGENTS.md, "Auth redirects").
  await signOut({ redirectTo: SESSION_EXPIRED_LOGIN_PATH });
}
