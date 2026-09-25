import { unsubscribeFromDigestByToken } from "@/lib/digest-unsubscribe";

// GAP-27: the URL in the weekly digest's `List-Unsubscribe` header.
//
// POST is RFC 8058 one-click unsubscribe: Gmail/Apple Mail/Yahoo send it
// (body `List-Unsubscribe=One-Click`) when someone presses the client's own
// "Unsubscribe" button, with no cookies and no chance to show a page — so it
// acts immediately on the signed token alone.
//
// GET only redirects to the /unsubscribe/[token] page, and never changes
// anything itself: mail security scanners and link previewers routinely
// fetch every URL in a message, and a GET that unsubscribed would switch
// people off without them ever clicking. The page does the actual write
// through a Server Action (same pattern as /verify-email/[token]).
export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: RouteContext<"/api/digest/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  try {
    const result = await unsubscribeFromDigestByToken(token);
    if (result === "invalid") {
      return Response.json({ status: "error", message: "Invalid unsubscribe link" }, { status: 400 });
    }
    return Response.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Digest unsubscribe failed:", error);
    return Response.json({ status: "error" }, { status: 500 });
  }
}

export async function GET(request: Request, ctx: RouteContext<"/api/digest/unsubscribe/[token]">) {
  const { token } = await ctx.params;
  return Response.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url), 303);
}
