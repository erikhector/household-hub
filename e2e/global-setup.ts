import type { FullConfig } from "@playwright/test";
import { seed } from "./seed";

// One seeded household per worker (e2e/seed-data.ts). `config.workers` is
// the resolved count, so a `--workers` on the command line is covered too.
export default async function globalSetup(config: FullConfig) {
  await seed(config.workers);
}
