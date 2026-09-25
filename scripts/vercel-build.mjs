// Vercel build command (vercel.json's `buildCommand`): runs
// `prisma migrate deploy` before `next build`, but only when this build is
// allowed to change the schema of the database it's pointed at.
//
// Why this exists: the build command used to be set in Vercel's dashboard as
// `npx prisma migrate deploy && next build` for *every* environment, so a
// Preview deployment pointed at production's DATABASE_URL applied a PR's
// migrations to the production database as soon as the preview built, while
// production was still serving master's code. PR #36's migration dropped
// Transaction.paidByMemberId that way, and every budget page on production
// then failed on a column that no longer existed. A preview must never be
// able to do that — see DEPLOYMENT.md's "Where this runs in a real deploy".
//
// Plain .mjs with no dependencies beyond node:* so it runs on Vercel's build
// image before anything is compiled.

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Decides whether this build may run `prisma migrate deploy`. `env` is
// process.env in practice; taken as an argument so it's testable.
//
// - Production (VERCEL_ENV=production) always migrates: its code must never
//   go live ahead of its schema.
// - Anything else (Preview, Development) skips unless MIGRATE_ON_PREVIEW=1 is
//   set for that environment in Vercel — which is only safe once Preview has
//   its own database, never while it shares production's.
// - Outside Vercel (VERCEL_ENV unset, e.g. a local `node scripts/vercel-build.mjs`)
//   skips too; locally you run `prisma migrate dev` yourself.
export function shouldRunMigrations(env) {
  if (env.VERCEL_ENV === "production") return true;
  return env.MIGRATE_ON_PREVIEW === "1";
}

function run(command) {
  console.log(`> ${command}`);
  execSync(command, { stdio: "inherit" });
}

function main() {
  if (shouldRunMigrations(process.env)) {
    run("npx prisma migrate deploy");
  } else {
    console.log(
      `Skipping prisma migrate deploy (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}). ` +
        "Only production builds migrate the database; set MIGRATE_ON_PREVIEW=1 " +
        "for an environment with its own database."
    );
  }
  run("npx next build");
}

// Only build when run as a script, not when the test imports
// shouldRunMigrations.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
