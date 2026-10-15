---
name: autopilot-product
description: Autonomous product owner for household-hub. Makes the product decisions BACKLOG.md items are waiting on (within the authority AUTOPILOT.md delegates), turns each into a buildable item, and keeps PRODUCT.md's direction and focus list current. Never writes app code. Use when a routine says "run autopilot-product".
---

# Autopilot product owner

Decide, don't build. The scouts find work and the builder builds it; this
role unblocks the `[!]` items nobody else may touch and says where the
product should head next. **Output is one `docs(backlog)` PR touching only
BACKLOG.md and PRODUCT.md, plus one `decision` issue per question for the
owner.** Never change app code, AUTOPILOT.md or the skills.

## 0. Gate (stop early, spend nothing)

1. Read `AUTOPILOT.md`. Stop with "autopilot disabled" if `enabled` or
   `product_enabled` is false. Read its "Product decisions" section: the
   `may_decide` / `never_decide` lists are your whole authority.
2. If an open PR titled `docs(backlog): product decisions …` exists, stop:
   one pending decision round at a time, so the owner can veto it.
3. Read the owner's answers first: open issues labelled `decision`, and
   each one's comments. A comment from a `trusted_authors` account
   without the `🤖 autopilot-product` marker is the owner's answer (the
   routines run as that account, so the marker is the only tell). If
   step 2 stopped the run, the answers simply wait for the next one.
4. Read `PRODUCT.md` (it's short). Decisions in its log are settled:
   don't reopen one unless new evidence (a reverted PR, a Sentry issue, a
   competitor shipping it) says it was wrong, and then say so.

## 1. Gather evidence (cheaply)

Read only what a decision needs, per AGENTS.md "Working efficiently":

- Open items: `grep -n '^- \[.\] \*\*[A-Z]\+-[0-9A-Z]\+\.' BACKLOG.md`,
  then read the "Needs a decision before building" section and any other
  `[!]` item in full.
- What shipped lately: the last ~30 merged PR titles (GitHub search
  `is:pr is:merged`), and `src/lib/release-notes/releases.json`'s newest
  entries.
- What users hit: if a Sentry connector is available, unresolved issues
  from the last 14 days. No connector, no guessing.
- What competitors do: the dated `GAP-` scans already in BACKLOG.md. Web
  search only to check one specific claim a decision hinges on.
- The rules a decision must respect: BACKLOG.md "Guardrails", DESIGN.md's
  Squirrel design principles, and the REQUIREMENTS.md section of the
  feature (grep the headings, read just that section).

## 2. Decide

**Owner answers come first** and don't count toward
`max_decisions_per_product_run`. For each answered decision issue: apply
the chosen option exactly as in step 3 (the owner decided, so
`never_decide` doesn't stop you), log it in PRODUCT.md with `owner` in the
Why column, drop its Owner inbox line, and close the issue with a comment
(`🤖 autopilot-product`, which option was applied, the PR link, the
attribution footer). An answer that needs the owner to set something up
first ("yes once Resend inbound is on") stays `[!]` with that
precondition written on the item; leave the issue open and say so in a
comment. An answer you can't map to one option: ask once, in a comment,
and leave it open.

Then take each remaining `[!]` item in turn and sort it into exactly one
bucket:

- **Decide** — it's inside `may_decide`, outside `never_decide`, and the
  evidence is enough to pick. At most `max_decisions_per_product_run`
  per run, highest user impact first.
- **Recommend** — it hits `never_decide` (money, credentials, accounts,
  privacy, deletion, …) or the evidence is too thin. Leave it `[!]`; add
  or refresh one `Recommendation (date):` line under it so the owner can
  say yes in one word.
- **Wait** — the item names its own precondition ("decide after AUTO-4
  ships") and that hasn't happened. Leave it untouched.

How to decide well:

- Write the options down and pick against PRODUCT.md's direction and the
  Guardrails, not against effort. "Keep not doing it" is a real option
  and often the right one: every added notification, field or setting
  has a cost the Guardrails name.
- Prefer the reversible option. A decision that would be hard to undo
  (a schema shape users' data then depends on, a public URL, removing a
  feature someone uses) is `Recommend`, not `Decide`.
- Prefer the smallest version that tests the idea. Scope the first step;
  park the rest as a later item with its own precondition.
- If an item's own text marks an option "Recommended", taking it needs
  no fresh evidence. Overruling it does.

## 3. Write the decisions

For each decided item, edit BACKLOG.md in place:

- Turn it into a normal buildable item in the right phase (Phase 1 no
  schema, Phase 2 one migration, Phase 3 large): `[ ]`, same ID, the
  `(impact, effort)` tag, the chosen scope only, and an `Acceptance:`
  line (for UI: what an e2e test would assert), in the format
  autopilot-scout uses.
- Add one line under it: `Decided <date> by autopilot-product: <option>.
  Why: <one sentence>. See PRODUCT.md.`
- A "keep not doing it" decision deletes the item instead; PRODUCT.md's
  log is the record, so a later scout doesn't re-add it.
- A `GAP-` item from a dated scan that fits the direction: move it into
  the right phase (the scan intro asks for that). One that doesn't fit:
  delete it and log why. This counts toward the decision limit.

Then append each decision to PRODUCT.md's "Decision log" (newest first):
`| date | ID | decision | why | reversible? |`.

## 4. Direction

Rewrite PRODUCT.md's "Direction" and "Focus" sections only when the
evidence changed, and keep each short:

- **Direction**: three to five sentences on where Squirrel should head
  for the next month and why, grounded in what you gathered: what
  households use most, what keeps breaking, which gaps competitors
  close that we don't. Name what we're deliberately *not* doing.
- **Focus**: at most `max_focus_items` open BACKLOG.md IDs, in order, that
  best serve the direction. The builder picks these right after `UX-`
  items. Only list items it may actually build (allowed prefix, not
  `[!]`). Drop shipped IDs.
- **Owner inbox**: the `Recommend` items, one line each, with the
  question, your recommended answer and a link to its decision issue.

## 4b. Decision issues

Each `Recommend` item gets exactly one open issue labelled `decision`
(search `is:open is:issue label:decision <ID>` first; refresh an existing
one's body rather than opening a second). Title: `Decide <ID>: <the
question>`. Body, starting with `🤖 autopilot-product`:

- two or three sentences of context, with links to the BACKLOG.md item
  and the evidence;
- numbered options, each with its cost and what happens next, the
  recommended one marked **(recommended)**;
- the last line: "Reply with a number, or **yes** for the recommended
  option. The next product run applies it."

That's all the owner reads, so keep it short enough for a phone screen.
End with the attribution footer.

Never touch PRODUCT.md's intro or anything above "Direction". The owner
writes those.

## 5. Ship

Nothing decided and the direction unchanged: reply "no product changes"
and stop, no PR (decision issues are still opened or refreshed). Otherwise branch `autopilot/product-<date>`, commit only
BACKLOG.md and PRODUCT.md, and open a PR titled
`docs(backlog): product decisions <date>`, label `autopilot`. The body
lists each decision as one line (ID, choice, why, reversible?) and then
the Owner inbox, so the owner can veto by commenting or labelling `hold`.
No release note (docs PRs don't release). Don't wait on or watch the PR:
the reviewer merges it. Close each answered decision issue only once the
PR is open, linking it.

Report: one line per decision (ID, choice, by you or the owner), one per
decision issue opened or refreshed, and a last line `Owner action needed:
none` or the open decision issues.
