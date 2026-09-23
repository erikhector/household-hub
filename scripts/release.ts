// Release script run by GitHub Actions, directly under Node's built-in
// TypeScript type stripping (Node 22.18+), so there's no `npm ci` or build
// step and it has no dependencies beyond node:*.
//
//   node scripts/release.ts preview   (PR release preview workflow)
//     Prints a Markdown summary of what merging this PR will release, for
//     the sticky PR comment. Exits 1 if the PR title isn't a valid
//     Conventional Commit, which makes the check fail.
//
//   node scripts/release.ts apply     (release workflow, after merge)
//     Bumps package.json and package-lock.json, prepends the entry to
//     src/lib/release-notes/releases.json, and writes `version` and
//     `released` to $GITHUB_OUTPUT for the later steps.
//
// PR data comes in via env vars (PR_TITLE, PR_BODY, PR_NUMBER) rather than
// being interpolated into the workflow's shell script, so a PR title can't
// inject shell commands.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { ALLOWED_TYPES, planRelease, type ReleaseEntry } from "../src/lib/release-notes/release-calc.ts";

const PACKAGE_JSON = "package.json";
const PACKAGE_LOCK = "package-lock.json";
const RELEASES_JSON = "src/lib/release-notes/releases.json";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function setOutput(name: string, value: string) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
  else console.log(`${name}=${value}`);
}

const mode = process.argv[2];
const pkg = readJson<{ version: string }>(PACKAGE_JSON);
const plan = planRelease({
  title: process.env.PR_TITLE ?? "",
  body: process.env.PR_BODY,
  pr: Number(process.env.PR_NUMBER ?? 0),
  currentVersion: pkg.version,
  date: new Date(),
});

if (mode === "preview") {
  // The marker lets the workflow find and update its own comment instead of
  // adding a new one on every push.
  const lines = ["<!-- release-preview -->", "### 🐿️ Release preview", ""];
  if (plan.status === "invalid-title") {
    lines.push(
      "❌ **The PR title must follow [Conventional Commits](https://www.conventionalcommits.org/):** `type(optional scope): description`",
      "",
      `Allowed types: ${ALLOWED_TYPES.map((t) => `\`${t}\``).join(", ")}. Add \`!\` after the type for a breaking change.`,
    );
  } else if (plan.status === "no-release") {
    lines.push(
      `Merging this \`${plan.parsed.kind}\` PR **won't cut a release**. The version stays at \`${pkg.version}\`.`,
      "",
      "Use `feat`, `fix` or `perf` if users will notice the change.",
    );
  } else {
    const { entry, type } = plan;
    lines.push(
      `Merging will release **v${entry.version}** (${type} bump from \`${pkg.version}\`).`,
      "",
      "This note will be shown in the app under **What's new**:",
      "",
      "| | |",
      "|---|---|",
      `| 🇬🇧 English | ${entry.notes.en.replace(/\n+/g, " ")} |`,
      `| 🇸🇪 Svenska | ${entry.notes.sv?.replace(/\n+/g, " ") ?? "_Not written: Swedish users will see the English note._"} |`,
      "",
      "_Edit the **Release note** section of the PR description to change it. This comment updates automatically._",
    );
  }
  console.log(lines.join("\n"));
  process.exit(plan.status === "invalid-title" ? 1 : 0);
}

if (mode === "apply") {
  if (plan.status === "invalid-title") {
    console.error("PR title is not a Conventional Commit; nothing to release.");
    setOutput("released", "false");
    process.exit(0);
  }
  if (plan.status === "no-release") {
    console.log(`"${plan.parsed.kind}" PR: no release.`);
    setOutput("released", "false");
    process.exit(0);
  }

  const { entry } = plan;
  writeJson(PACKAGE_JSON, { ...readJson<object>(PACKAGE_JSON), version: entry.version });

  // Keeps the lockfile's copies of the root version in step, so the release
  // commit doesn't leave `npm install` with a lockfile diff to make.
  const lock = readJson<{ version: string; packages: Record<string, { version?: string }> }>(PACKAGE_LOCK);
  lock.version = entry.version;
  if (lock.packages[""]) lock.packages[""].version = entry.version;
  writeJson(PACKAGE_LOCK, lock);

  const releases = readJson<ReleaseEntry[]>(RELEASES_JSON);
  writeJson(RELEASES_JSON, [entry, ...releases]);

  // Body for the GitHub Release the workflow creates next.
  const bodyFile = process.env.RELEASE_BODY_FILE;
  if (bodyFile) {
    const body = [entry.notes.en, entry.notes.sv ? `\n🇸🇪 ${entry.notes.sv}` : "", `\n\nPR: #${entry.pr}`];
    writeFileSync(bodyFile, body.join(""));
  }

  console.log(`Released v${entry.version}`);
  setOutput("released", "true");
  setOutput("version", entry.version);
  process.exit(0);
}

console.error("Usage: node scripts/release.ts <preview|apply>");
process.exit(2);
