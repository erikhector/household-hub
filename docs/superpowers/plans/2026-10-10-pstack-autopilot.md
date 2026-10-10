# pstack Autopilot Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor a pinned pstack skill slice and tight-wire it into the autopilot builder and reviewer sub-agent prompts on a feature branch with a PR.

**Architecture:** Single pinned upstream commit vendored to the repo skill dirs with a repo-local inherit-parent model map, plus one-line explicit-call wiring in the two autopilot skills and an AGENTS.md paragraph. No coordinator, limit, merge-policy, or CI-gate changes.

**Tech Stack:** Markdown Agent Skills (`SKILL.md` + playbooks), OpenCode (`.agents/skills/`), Claude Code (`.claude/skills/`), git feature branch + GitHub PR.

**Spec:** `docs/superpowers/specs/2026-10-10-pstack-autopilot-design.md`

## Global Constraints

- Superpowers keeps process routing; pstack is explicit-call only inside the two autopilot sub-agent prompts; repo conventions win on conflict.
- Every pstack role maps to `inherit-parent`; no paid model slug, no new paid service, account, or key.
- Coordinator never writes app code; parallel-safe rules, per-run limits, merge policy, and CI gate are unchanged.
- Do not touch `AUTOPILOT.md` limits or `.github/workflows/` in this item.
- Keep upstream skill names and `name` + `description` frontmatter intact; local wrappers get their own names if needed.
- Record the upstream commit SHA plus final file list in the PR body and in REQUIREMENTS.md.
- Work on a feature branch, never `master`; one concern only; Conventional Commit title; PR template filled in with bilingual user-facing release note.
- The loop runs without human intervention: the coordinator is the human proxy and answers sub-agent questions; agents never block on a human; reversible work proceeds and reports; irreversible writes pause for the coordinator.
- Run `npm run check` plus build before push; run the `self-review` skill before opening the PR.

## Review Focus

- Skill ID collision causes the wrong framework to trigger on `tdd`/`architect` wording in a sub-agent prompt, and a reasonable person expects the prompt to name pstack explicitly. Pinned by Task 2 grep test for the explicit `pstack/`-qualified call line.
- Model mapping file is present but the vendored router reads a different lookup path, silently ignoring `inherit-parent`, and a reasonable person expects no paid-model routing. Pinned by Task 1 test asserting the router text references the shipped path.
- A referenced playbook path moved upstream at the pin, and a reasonable person expects every pointer in the wiring to resolve. Pinned by Task 1 existence test over every referenced playbook path.
- Harness auto-trigger loads vendored skills on description match even when not called, blowing up context, and a reasonable person expects zero cost when pstack is not invoked. Pinned by Task 2 test asserting wiring says explicit-call only with no pre-read instruction.
- Upstream renames or drops a sliced skill between spec and pin day, and a reasonable person expects the PR to list the drop rather than ship a broken pointer. Pinned by Task 1 test asserting slice-list vs. on-disk reconciliation with drops recorded.

---

### Task 1: Pin upstream and vendor the skill slice

**Files:**
- Create: `.agents/skills/<skill>/SKILL.md` for each sliced skill (or single canonical copy if the builder proves one location loads in both harnesses; document the decision in the PR body)
- Mirror: `.claude/skills/<skill>/SKILL.md` (same content, same SHA) unless single-copy proof above applies
- Create: `.agents/pstack-models.md` (every role `inherit-parent`)
- Create: `skills/<name>/SKILL.md` playbook refs preserved as vendored (`skills/poteto-mode/playbooks/*.md` for `feature`, `bug-fix`, `refactoring`, `babysit`, `shipping`, `opening-a-pr`)
- Test: local shell checks (no new test file; commands below are the tests)

**Interfaces:**
- Consumes: Spec slice list (poteto-mode + how, why, architect, interrogate, tdd, unslop, technical-writing, no-comments, reflect + 10 named principles)
- Produces: `PSTACK_PIN_SHA` (40-char commit SHA) and `PSTACK_FILE_LIST` (exact vendored paths) consumed by Tasks 2–3 for pointers and docs

- [ ] **Step 1: Create the feature branch**

Run: `git checkout -b feat/pstack-autopilot-<7-char-suffix> origin/master`
Expected: `git branch --show-current` prints the new branch. All commits below land on this branch, never `master`.

- [ ] **Step 2: Resolve the pin SHA**

Run: `git ls-remote https://github.com/backnotprop/pstack HEAD`
Expected: one 40-char SHA on `refs/heads/main`; record as `PSTACK_PIN_SHA`.

- [ ] **Step 2: Verify license permits vendoring**

Run: fetch `https://raw.githubusercontent.com/backnotprop/pstack/<PSTACK_PIN_SHA>/LICENSE` and confirm the first line names MIT.
Expected: MIT present; otherwise stop and report.

- [ ] **Step 3: Write the failing slice check (red)**

Write and run a shell loop asserting each spec-listed `skills/<name>/SKILL.md` exists locally under `.agents/skills/` (and mirror or single-copy proof).
Expected: FAIL (files not yet vendored).

- [ ] **Step 4: Vendor the files at the pin**

Fetch each file at `https://raw.githubusercontent.com/backnotprop/pstack/<PSTACK_PIN_SHA>/skills/<name>/SKILL.md` plus the six named playbooks under `skills/poteto-mode/playbooks/`, writing bytes verbatim to the decided local paths. Do not rename skill `name` fields. Record any upstream-missing file as a drop.
Expected: on-disk files match the pin; drops listed (possibly empty).

- [ ] **Step 5: Write `.agents/pstack-models.md` with every role `inherit-parent`**

Content shape (exact keys follow the vendored router's settings-file schema; every value is the literal `inherit-parent`):

```markdown
# pstack models — repo-local override
# Every role runs on the scheduled session's model.
- code: inherit-parent
- hardest tasks: inherit-parent
- judgment and prose: inherit-parent
- how explorer: inherit-parent
- how explainer: inherit-parent
```

Expected: file exists; `grep -c inherit-parent .agents/pstack-models.md` equals the role-line count.

- [ ] **Step 6: Run slice checks to green**

Run: frontmatter parse over every vendored `SKILL.md` (assert `name:` and `description:` present); existence check over every playbook path referenced by the vendored `poteto-mode/SKILL.md` wiring lines; grep the vendored router for its settings-file lookup and assert it resolves to the shipped `.agents/pstack-models.md` path; reconcile slice-list vs. on-disk and assert drops are recorded.
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add .agents/skills .claude/skills .agents/pstack-models.md
git commit -m "feat: vendor pinned pstack skill slice for autopilot loop"
```

### Task 2: Tight-wire the autopilot sub-agent prompts

**Files:**
- Modify: `.claude/skills/autopilot-build/SKILL.md` (`Sub-agent: build one item` + `Sub-agent: fix one PR` sections)
- Modify: `.claude/skills/autopilot-review/SKILL.md` (`Sub-agent: review one PR` section)
- Modify: `AGENTS.md` (Autonomous loop paragraph)
- Test: shell grep checks (commands below are the tests)

**Interfaces:**
- Consumes: `PSTACK_PIN_SHA`, `PSTACK_FILE_LIST` from Task 1
- Produces: exact wiring lines consumed by Task 3 docs and PR body

- [ ] **Step 1: Write the failing wiring check (red)**

Run: `grep -r "poteto-mode" .claude/skills/autopilot-build/SKILL.md .claude/skills/autopilot-review/SKILL.md` and `grep -n "pstack" AGENTS.md` and `grep -n "human proxy" .claude/skills/autopilot-build/SKILL.md`.
Expected: FAIL (no matches yet).

- [ ] **Step 2: Add the coordinator proxy line to `autopilot-build`**

Insert one line in the `Delegate (coordinator)` section, exact text:

```markdown
The coordinator is the human proxy: it answers any question a sub-agent has; sub-agents never block on a human. Reversible work proceeds with the result reported; irreversible writes pause for the coordinator's explicit call.
```

Expected: `grep -c "human proxy" .claude/skills/autopilot-build/SKILL.md` equals 1.

- [ ] **Step 3: Add explicit-call wiring to `autopilot-build`**

Insert one line in each of the two sub-agent sections, pointing at the vendored file without pasting the procedure, exact text:

```markdown
Match a `poteto-mode` playbook first (`feature` for behavior, `bug-fix` for defects, `refactoring` for structure-only), then follow it through this file's own orient/implement/test/verify gate. Call pstack skills explicitly by ID; do not pre-read uncalled playbooks or principles.
```

Expected: `grep -c "poteto-mode" .claude/skills/autopilot-build/SKILL.md` equals 2.

- [ ] **Step 3: Add explicit-call wiring to `autopilot-review`**

Insert one line in `Sub-agent: review one PR` before the post step, exact text:

```markdown
Before posting, apply the vendored `no-comments` hygiene pass and the human-only deeper read where AUTOPILOT.md requires it. Call pstack skills explicitly by ID; do not pre-read uncalled skills.
```

Expected: `grep -c "no-comments" .claude/skills/autopilot-review/SKILL.md` equals 1.

- [ ] **Step 4: Add the AGENTS.md paragraph**

Append to the `## Autonomous loop` section, exact text:

```markdown
Autopilot sub-agents may call the vendored pstack slice explicitly by skill ID (Superpowers keeps process routing; repo conventions win on conflict). Model mapping is repo-local `inherit-parent` in `.agents/pstack-models.md`.
```

Expected: `grep -c "pstack" AGENTS.md` is at least 1.

- [ ] **Step 5: Run wiring checks to green**

Run: the Step 1 greps (now PASS); assert no wiring line pastes upstream procedure (wiring diff under 12 added lines total across the two skills); assert every named skill ID in added lines exists on disk from Task 1.
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/autopilot-build/SKILL.md .claude/skills/autopilot-review/SKILL.md AGENTS.md
git commit -m "feat: wire vendored pstack slice into autopilot prompts"
```

### Task 3: Document, verify, self-review, open the PR

**Files:**
- Modify: `REQUIREMENTS.md` (Autonomous improvement loop section: vendored slice + `PSTACK_PIN_SHA` + wiring points)
- Test: `npm run check`, `npm run build`
- Review: `.claude/skills/self-review/SKILL.md`

**Interfaces:**
- Consumes: `PSTACK_PIN_SHA`, `PSTACK_FILE_LIST`, wiring lines from Tasks 1–2
- Produces: feature branch + PR URL

- [ ] **Step 1: Verify the feature branch**

Run: `git branch --show-current`
Expected: prints `feat/pstack-autopilot-*` from Task 1. If not on it, stop and check out the Task 1 branch before touching files.

- [ ] **Step 2: Update REQUIREMENTS.md shipped behavior**

Add to the Autonomous improvement loop section: the vendored slice names, `PSTACK_PIN_SHA`, the two wiring points, the `inherit-parent` rule, and the Superpowers-precedence rule.
Expected: `grep -c "pstack" REQUIREMENTS.md` is at least 1.

- [ ] **Step 3: Run `npm run check`**

Run: `npm run check`
Expected: lint + typecheck + unit tests all PASS, nothing skipped.

- [ ] **Step 4: Run `npm run build`**

Run: `npm run build`
Expected: build PASS.

- [ ] **Step 5: Run the `self-review` skill and fix findings**

Follow `.claude/skills/self-review/SKILL.md` against the branch diff, then re-read the diff asking what a careful reviewer would reject; fix it.
Expected: no open self-review findings.

- [ ] **Step 6: Open the PR**

Title (Conventional Commit): `feat: wire pinned pstack slice into autopilot loop`. Body: PR template filled in, bilingual user-facing release note, Verification section with `check` + build summaries, vendored `PSTACK_PIN_SHA` + `PSTACK_FILE_LIST` (with drops if any), and `inherit-parent` note. Label `autopilot` only if the loop owns it, else no label games.
Expected: PR URL returned; branch pushed; CI starts.
