import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { resolveShareTarget, SHARE_PATH } from "@/lib/share-target";

// GAP-67: landing point of the manifest's `share_target` (a GET, so the
// shared link or text arrives as query params). proxy.ts already sends a
// logged-out visitor to /login?next=<this url> and back, but the session is
// read here too so the handler never depends on the matcher for that. It
// only redirects: nothing is imported or added until the user confirms in the
// dialog it opens.
export async function GET(request: NextRequest) {
  const { searchParams, search } = request.nextUrl;

  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL("/login", request.nextUrl);
    login.searchParams.set("next", SHARE_PATH + search);
    return NextResponse.redirect(login);
  }

  const target =
    resolveShareTarget({ text: searchParams.get("text"), url: searchParams.get("url") }) ?? "/dashboard";
  return NextResponse.redirect(new URL(target, request.nextUrl));
}
