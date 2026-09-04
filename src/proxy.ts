import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";

// Uses the Edge-safe config (no Prisma-backed providers) since proxy.ts
// runs in the Edge runtime.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isLandingPage = pathname === "/";
  // /login and /signup are logged-out-only; /join/[token] is intentionally
  // excluded — it doubles as a signup entry point (accept-invite) for
  // logged-out visitors, see REQUIREMENTS.md.
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isProtectedPage = pathname.startsWith("/dashboard");

  if (!isLoggedIn && isProtectedPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isLoggedIn && (isAuthPage || isLandingPage)) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
