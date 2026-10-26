// The one place the service worker's script URL is built, because both
// registration sites (service-worker-registration.tsx and
// push-notifications-card.tsx) must pass the *same* URL: the browser treats
// a different URL as a different script and would swap workers back and
// forth.
//
// Production builds append `?prod=1`, which switches on the worker's
// cache-first handling of /_next/static/* (PERF-28). That is only safe
// because production chunk names are content hashes. `next dev` chunk URLs
// aren't guaranteed to change with their content, so without the flag the
// worker stays network-only there and developers never get stale code.
export function serviceWorkerUrl(): URL {
  const url = new URL("./service-worker.js", import.meta.url);
  if (process.env.NODE_ENV === "production") url.searchParams.set("prod", "1");
  return url;
}
