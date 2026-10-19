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
//   node scripts/release.ts train-prs <master>..<release branch>
//     Prints the numbers of the PRs squash-merged into `next` in that range,
//     one per line, oldest first. The workflows fetch each one's title and
//     body with `gh` into the JSON file below. A commit whose subject has no
//     "(#N)" is looked up on GitHub by SHA with `gh api` (GH_TOKEN), and if
//     that fails the command exits 1: silently dropping a PR means a
//     release that ships its code without its version or note.
//
// PR data comes in via env vars (PR_TITLE, PR_BODY, PR_NUMBER) rather than
// being interpolated into the workflow's shell script, so a PR title can't
// inject shell commands. For the release PR (a `release/*` branch cut from
// `next`, into `master`: the release train), TRAIN_PRS_FILE names a JSON
// array of the included PRs' `{ number, title, body }` and PR_NUMBER is the
// release PR's own number; its own title and body are ignored. BASE_REF=next
// marks a feature PR into `next`, whose preview says what it adds to the
// next release instead of promising a version.

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import {
  ALLOWED_TYPES,
  planRelease,
  planTrainRelease,
  missingReleaseNotes,
  parseTrainLog,
  type ReleaseEntry,
  type TrainPr,
} from "../src/lib/release-notes/release-calc.ts";

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

if (mode === "train-prs") {
  const range = process.argv[3];
  if (!range) {
    console.error("Usage: node scripts/release.ts train-prs <master>..<release branch>");
    process.exit(2);
  }
  const log = execFileSync("git", ["log", "--first-parent", "--format=%H %s", range], { encoding: "utf8" });
  const repo = process.env.GITHUB_REPOSITORY ?? "{owner}/{repo}";
  const numbers: number[] = [];
  for (const commit of parseTrainLog(log)) {
    if (commit.sync) continue;
    let pr = commit.pr;
    if (pr === null) {
      // The PR whose squash (or merge) commit this is. Matching on
      // merge_commit_sha, not just "PRs containing this commit", keeps the
      // release PR itself (which contains every commit) out.
      let found: string;
      try {
        found = execFileSync(
          "gh",
          ["api", `repos/${repo}/commits/${commit.sha}/pulls`, "--jq", `.[] | select(.merge_commit_sha == "${commit.sha}") | .number`],
          { encoding: "utf8" },
        ).trim();
      } catch {
        console.error(`Commit ${commit.sha} has no "(#N)" in its subject and GitHub couldn't be asked which PR it came from (is gh installed and GH_TOKEN set?).`);
        process.exit(1);
      }
      if (!found) {
        console.error(`Commit ${commit.sha} came from no PR (pushed straight to the branch); nothing to release for it.`);
        continue;
      }
      pr = Number(found.split("\n")[0]);
    }
    if (!numbers.includes(pr)) numbers.push(pr);
  }
  console.log(numbers.join("\n"));
  process.exit(0);
}

const pkg = readJson<{ version: string }>(PACKAGE_JSON);
const trainFile = process.env.TRAIN_PRS_FILE;
const train = trainFile
  ? planTrainRelease({
      prs: readJson<TrainPr[]>(trainFile),
      pr: Number(process.env.PR_NUMBER ?? 0),
      currentVersion: pkg.version,
      date: new Date(),
    })
  : null;
const plan = train
  ? null
  : planRelease({
      title: process.env.PR_TITLE ?? "",
      body: process.env.PR_BODY,
      pr: Number(process.env.PR_NUMBER ?? 0),
      currentVersion: pkg.version,
      date: new Date(),
    });
const intoNext = process.env.BASE_REF === "next";

function noteTable(entry: ReleaseEntry): string[] {
  return [
    "| | |",
    "|---|---|",
    `| 🇬🇧 English | ${entry.notes.en.replace(/\n+/g, "<br>")} |`,
    `| 🇸🇪 Svenska | ${entry.notes.sv?.replace(/\n+/g, "<br>") ?? "_Not written: Swedish users will see the English note._"} |`,
  ];
}

if (mode === "preview") {
  // The marker lets the workflow find and update its own comment instead of
  // adding a new one on every push.
  const lines = ["<!-- release-preview -->", "### 🐿️ Release preview", ""];
  if (train) {
    lines.push(
      train.status === "release"
        ? `Merging this release PR will ship **v${train.entry.version}** (${train.type} bump from \`${pkg.version}\`) with these PRs from \`next\`:`
        : `Merging this release PR **won't cut a release**: none of the PRs from \`next\` is a \`feat\`, \`fix\` or \`perf\`. The version stays at \`${pkg.version}\`.`,
      "",
      ...train.items.map((i) => `- #${i.pr} ${i.title}${i.type ? ` _(${i.type})_` : ""}`),
    );
    if (train.items.length === 0) lines.push("_The release branch has nothing that isn't on `master` yet._");
    if (train.status === "release") {
      lines.push("", "This note will be shown in the app under **What's new**:", "", ...noteTable(train.entry));
    }
    lines.push("", "_Each note comes from that PR's **Release note** section. This comment updates when the release branch moves._");
    console.log(lines.join("\n"));
    process.exit(0);
  }
  if (!plan) throw new Error("unreachable");
  const missing = plan.status === "release" ? missingReleaseNotes(process.env.PR_BODY) : [];
  if (plan.status === "invalid-title") {
    lines.push(
      "❌ **The PR title must follow [Conventional Commits](https://www.conventionalcommits.org/):** `type(optional scope): description`",
      "",
      `Allowed types: ${ALLOWED_TYPES.map((t) => `\`${t}\``).join(", ")}. Add \`!\` after the type for a breaking change.`,
    );
  } else if (plan.status === "no-release") {
    lines.push(
      intoNext
        ? `This \`${plan.parsed.kind}\` PR **adds nothing to the next release's note**.`
        : `Merging this \`${plan.parsed.kind}\` PR **won't cut a release**. The version stays at \`${pkg.version}\`.`,
      "",
      "Use `feat`, `fix` or `perf` if users will notice the change.",
    );
  } else {
    const { entry, type } = plan;
    if (missing.length > 0) {
      lines.push(
        `❌ **Write the release note in ${missing.join(" and ")}.** A releasing PR needs both, or Swedish users get English text under What's new.`,
        "",
      );
    }
    lines.push(
      intoNext
        ? `Merging queues this for the next release (at least a **${type}** bump). It ships with the next release PR into \`master\`.`
        : `Merging will release **v${entry.version}** (${type} bump from \`${pkg.version}\`).`,
      "",
      intoNext ? "This note will be part of the release's **What's new** entry:" : "This note will be shown in the app under **What's new**:",
      "",
      ...noteTable(entry),
      "",
      "_Edit the **Release note** section of the PR description to change it. This comment updates automatically._",
    );
  }
  console.log(lines.join("\n"));
  process.exit(plan.status === "invalid-title" || missing.length > 0 ? 1 : 0);
}

if (mode === "apply") {
  const result = train ?? plan;
  if (!result) throw new Error("unreachable");
  if (result.status === "invalid-title") {
    console.error("PR title is not a Conventional Commit; nothing to release.");
    setOutput("released", "false");
    process.exit(0);
  }
  if (result.status === "no-release") {
    console.log("parsed" in result ? `"${result.parsed.kind}" PR: no release.` : "No feat, fix or perf PR in the train: no release.");
    setOutput("released", "false");
    process.exit(0);
  }

  const { entry } = result;
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
    const prs = train ? `\n\nPRs: ${train.items.map((i) => `#${i.pr}`).join(", ")} (release PR #${entry.pr})` : `\n\nPR: #${entry.pr}`;
    const body = [entry.notes.en, entry.notes.sv ? `\n🇸🇪 ${entry.notes.sv}` : "", prs];
    writeFileSync(bodyFile, body.join(""));
  }

  console.log(`Released v${entry.version}`);
  setOutput("released", "true");
  setOutput("version", entry.version);
  process.exit(0);
}

console.error("Usage: node scripts/release.ts <preview|apply|train-prs>");
process.exit(2);
