// The "last seen release" cookie's name and lifetime, kept apart from
// index.ts on purpose: index.ts imports the whole release history
// (releases.json), and a Client Component that only needs these constants
// (mark-release-seen.tsx) would drag that JSON into the browser bundle.
// Nothing in this file may import index.ts or releases.json; the guard test
// in src/lib/release-notes/client-bundle.test.ts enforces it.
//
// Stores the newest version the user has opened "What's new" for, so the
// sidebar can show an unread dot until they look at a new release. A
// preference-category cookie (see src/lib/cookie-inventory.ts): it only
// affects that dot.
export const LAST_SEEN_RELEASE_COOKIE = "last_seen_release";
export const LAST_SEEN_RELEASE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
