# Task G: Terms of Service + Privacy Policy pages — Progress

- [x] Explore existing page structure/styling conventions (login/join pages)
- [x] Explore i18n dictionary pattern, decide if full EN/SV translation is proportionate
      -> decided: dictionary keeps nav/footer/consent strings in EN+SV
         (short-string shape fits), but the two legal pages' body text is
         English-only prose (long-form legal content doesn't fit the
         `{key}`-interpolation dictionary shape and duplicating a legal
         document in two languages adds legal-accuracy risk for a task
         explicitly flagged for later legal review anyway).
- [x] Read prisma/schema.prisma User model to ground data-collection claims
- [x] Read src/lib/email.ts to confirm Resend is the only third-party data flow
- [x] Check for analytics/tracking scripts before asserting there are none (none found)
- [x] Check account deletion status (Wave 2 tasks K/L/M) to phrase policy correctly
      -> no self-service account deletion yet; household deletion (owner-only,
         "Danger zone") does exist and is described. Account-level requests
         are phrased as "contact the household owner / instance operator".
- [x] Create src/app/terms/page.tsx
- [x] Create src/app/privacy/page.tsx
- [x] Add footer/nav links to /terms and /privacy (new LegalFooter component,
      added to landing page, login, signup, join pages — no prior shared
      public-page layout existed)
- [x] Add links near submit button on signup form (and join-signup-form,
      which also creates an account)
- [x] Update PRODUCTION_READINESS.md line for task G with legal-review flag
- [x] Run npm run lint
- [x] Run npx tsc --noEmit
- [x] Run npm run test
- [x] Commit work
- [x] Final report
