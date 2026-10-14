// Pure release logic shared by the GitHub Actions release script
// (scripts/release.ts) and its tests. One merged PR = at most one release:
// the PR title (Conventional Commits, enforced by the "PR release preview"
// workflow) decides the semver bump, and the "Release note" section of the
// PR body becomes the user-facing note shown on /dashboard/whats-new.
//
// Deliberately import-free and free of enums/namespaces: scripts/release.ts
// runs this file directly under Node's built-in TypeScript type stripping
// (no build step, no `npm ci` in the release job), which can't resolve the
// `@/` alias and rejects any syntax that needs a real transform.

export type ReleaseType = "major" | "minor" | "patch";

export type ReleaseNotes = { en: string; sv: string | null };

export type ReleaseEntry = {
  version: string;
  /** YYYY-MM-DD, UTC — the day the PR was merged. */
  date: string;
  pr: number;
  /** Conventional Commits type from the PR title (feat, fix, perf, …). */
  kind: string;
  breaking: boolean;
  notes: ReleaseNotes;
};

// Types that ship something a user could notice. Everything else (docs,
// tests, CI, refactors, chores) still goes through a PR but doesn't cut a
// release, so "What's new" never fills up with "Updated README".
const RELEASING_TYPES: Record<string, ReleaseType> = {
  feat: "minor",
  fix: "patch",
  perf: "patch",
  revert: "patch",
};
const NON_RELEASING_TYPES = ["refactor", "docs", "test", "ci", "chore", "build", "style"];
export const ALLOWED_TYPES = [...Object.keys(RELEASING_TYPES), ...NON_RELEASING_TYPES];

const TITLE_RE = /^(\w+)(?:\(([^)]+)\))?(!)?: (\S.*)$/;

export type ParsedTitle = {
  kind: string;
  scope: string | null;
  breaking: boolean;
  description: string;
};

export function parsePrTitle(title: string): ParsedTitle | null {
  const match = TITLE_RE.exec(title.trim());
  if (!match) return null;
  const [, kind, scope, bang, description] = match;
  if (!ALLOWED_TYPES.includes(kind)) return null;
  return { kind, scope: scope ?? null, breaking: bang === "!", description: description.trim() };
}

/** null means "merge without releasing". */
export function releaseTypeFor(parsed: ParsedTitle): ReleaseType | null {
  if (parsed.breaking) return "major";
  return RELEASING_TYPES[parsed.kind] ?? null;
}

export function bumpVersion(version: string, type: ReleaseType): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Not a plain semver version: "${version}"`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (type === "major") return `${major + 1}.0.0`;
  if (type === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Negative if a < b, positive if a > b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Pulls the text under a `### <heading>` line of the PR body, up to the next
// Markdown heading. HTML comments (the template's instructions) are removed
// first so an untouched template reads as "no note written".
function section(body: string, heading: string): string | null {
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n");
  const lines = cleaned.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `### ${heading.toLowerCase()}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line.trim()));
  const text = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return text.length > 0 ? text : null;
}

export function extractReleaseNotes(body: string | null | undefined, fallback: string): ReleaseNotes {
  const text = body ?? "";
  const en = section(text, "English") ?? fallback;
  const sv = section(text, "Svenska");
  return { en, sv };
}

// Capitalized description from the PR title — the fallback note when the
// author left the Release note section empty.
export function titleFallback(parsed: ParsedTitle): string {
  const d = parsed.description;
  return d.charAt(0).toUpperCase() + d.slice(1);
}

export type ReleasePlan =
  | { status: "invalid-title" }
  | { status: "no-release"; parsed: ParsedTitle }
  | { status: "release"; parsed: ParsedTitle; type: ReleaseType; entry: ReleaseEntry };

export function planRelease(input: {
  title: string;
  body: string | null | undefined;
  pr: number;
  currentVersion: string;
  date: Date;
}): ReleasePlan {
  const parsed = parsePrTitle(input.title);
  if (!parsed) return { status: "invalid-title" };
  const type = releaseTypeFor(parsed);
  if (!type) return { status: "no-release", parsed };
  return {
    status: "release",
    parsed,
    type,
    entry: {
      version: bumpVersion(input.currentVersion, type),
      date: input.date.toISOString().slice(0, 10),
      pr: input.pr,
      kind: parsed.kind,
      breaking: parsed.breaking,
      notes: extractReleaseNotes(input.body, titleFallback(parsed)),
    },
  };
}

// ── Release train ────────────────────────────────────────────────────────
// Feature PRs squash-merge into `next` without releasing; one release PR (a
// `release/*` branch cut from `next`, into `master`) later ships them
// together as a single version (see
// REQUIREMENTS.md, "Releases & What's new"). These two helpers turn that
// release PR into one ReleaseEntry.

export type TrainCommit = { sha: string; pr: number | null; sync: boolean };

// Parses `git log --first-parent --format="%H %s" <master>..<release>`
// output, oldest first, so the combined note reads in merge order.
// GitHub's default squash commit subject is "<PR title> (#123)", so `pr` is
// that number when the subject ends in one. It can't be trusted to: a merge
// through the API with an explicit commit title drops the suffix (release
// #211 shipped #209 and #207 that way and released nothing), so a commit
// with `pr: null` must be looked up on GitHub by SHA rather than skipped.
// The one exception is `sync`: the "sync master into next" merge the
// release workflow pushes itself, which never has a PR.
export function parseTrainLog(log: string): TrainCommit[] {
  const commits: TrainCommit[] = [];
  for (const line of log.split("\n").reverse()) {
    const match = /^([0-9a-f]{7,40}) (.*)$/.exec(line.trim());
    if (!match) continue;
    const [, sha, subject] = match;
    const pr = /\(#(\d+)\)\s*$/.exec(subject);
    commits.push({
      sha,
      pr: pr ? Number(pr[1]) : null,
      sync: !pr && subject.startsWith("chore: sync master into next"),
    });
  }
  return commits;
}

export type TrainPr = { number: number; title: string; body: string | null | undefined };

export type TrainItem = { pr: number; title: string; type: ReleaseType | null };

export type TrainPlan =
  | { status: "no-release"; items: TrainItem[] }
  | { status: "release"; type: ReleaseType; entry: ReleaseEntry; items: TrainItem[] };

const RANK: Record<ReleaseType, number> = { patch: 1, minor: 2, major: 3 };

// The biggest bump among the included PRs wins (one `feat` and three `fix`
// → minor), and the releasing PRs' notes are joined as paragraphs, which
// /dashboard/whats-new already renders (`whitespace-pre-line`). A PR with
// no Swedish note contributes its English one to the Swedish text rather
// than dropping out of it; the note is only `null` when no PR wrote one,
// so the app's usual English fallback applies. A title that somehow isn't
// a Conventional Commit counts as non-releasing: the preview on the PR into
// `next` already failed it, and one bad title shouldn't block the train.
export function planTrainRelease(input: {
  prs: TrainPr[];
  pr: number;
  currentVersion: string;
  date: Date;
}): TrainPlan {
  const items: TrainItem[] = [];
  const releasing: { parsed: ParsedTitle; type: ReleaseType; notes: ReleaseNotes }[] = [];
  for (const pr of input.prs) {
    const parsed = parsePrTitle(pr.title);
    const type = parsed ? releaseTypeFor(parsed) : null;
    items.push({ pr: pr.number, title: pr.title, type });
    if (parsed && type) releasing.push({ parsed, type, notes: extractReleaseNotes(pr.body, titleFallback(parsed)) });
  }
  if (releasing.length === 0) return { status: "no-release", items };

  const top = releasing.reduce((best, r) => (RANK[r.type] > RANK[best.type] ? r : best));
  const anySv = releasing.some((r) => r.notes.sv !== null);
  return {
    status: "release",
    type: top.type,
    items,
    entry: {
      version: bumpVersion(input.currentVersion, top.type),
      date: input.date.toISOString().slice(0, 10),
      pr: input.pr,
      kind: top.parsed.kind,
      breaking: releasing.some((r) => r.parsed.breaking),
      notes: {
        en: releasing.map((r) => r.notes.en).join("\n\n"),
        sv: anySv ? releasing.map((r) => r.notes.sv ?? r.notes.en).join("\n\n") : null,
      },
    },
  };
}
