import { headers } from "next/headers";

/**
 * The deployer-configured base URL (`APP_URL`, trailing slashes stripped), or
 * undefined when it's unset. Exposed separately for callers that only want the
 * configured origin and no request-header guess (the email logo, which would
 * be useless pointing at localhost).
 */
export function configuredAppUrl(): string | undefined {
  return process.env.APP_URL?.trim().replace(/\/+$/, "") || undefined;
}

/**
 * Absolute URL for `path`, for links that leave the app (emails, share links,
 * calendar feeds).
 *
 * Building this from the request's Host/X-Forwarded-Host header alone would
 * let anyone who can shape their own HTTP request (trivial with curl — the
 * browser's address bar plays no part in it) get this app to hand back a
 * link that points at an attacker-controlled domain, while the token embedded
 * in it is entirely real. That's a phishing primer disguised as a legitimate
 * invite / reset / verification link, so the base URL must come from a value
 * only the deployer controls. APP_URL is checked first; the header-derived
 * guess only remains as a local-dev convenience when it's unset (so
 * `npm run dev` keeps working with no setup).
 */
export async function absoluteAppUrl(path: string): Promise<string> {
  const configured = configuredAppUrl();
  if (configured) return `${configured}${path}`;

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}${path}`;
}
