# Design skills vendored — attribution and pins

Two UI design skills, vendored verbatim. Repo rules (AGENTS.md,
DESIGN.md and its Mobile UX rules M1–M10) win over both on any
conflict; see AGENTS.md, "Agent skills".

## frontend-design

Upstream: https://github.com/anthropics/skills (`skills/frontend-design`).
Pinned commit: `ca45fc496a3436251f191354091d557da31c15b5` (upstream
`main` at vendor time). `SKILL.md` and `LICENSE.txt` are verbatim
copies at that commit.

License: Apache License 2.0, full text in `frontend-design/LICENSE.txt`.

## impeccable

Upstream: https://github.com/pbakaus/impeccable (skill version 4.8.0).
Pinned commit: `df3a4abe7d0840d5f60324812c432e00b66a4e75` (upstream
`main` at vendor time). `SKILL.md` and `reference/` are verbatim copies
of upstream's Claude Code build (`.claude/skills/impeccable/`) at that
commit. `LICENSE` and `NOTICE.md` are upstream's root files, copied
verbatim to meet the Apache 2.0 notice terms.

License: Apache License 2.0, Copyright 2025 Paul Bakaus. Full text in
`impeccable/LICENSE`; third-party notices in `impeccable/NOTICE.md`.

The same Claude Code build is used for the OpenCode mirror in
`.agents/skills/`. Upstream's OpenCode build differs only in launcher
paths and an `allowed-tools` header that pre-approves
`npx impeccable *`, which would bring back the download dropped below.

### Deliberate drops at this pin

`scripts/`: the `impeccable` launcher and its data. On first run the
launcher downloads a native binary from upstream's GitHub releases and
executes it, which scheduled autopilot sessions would do unattended,
and the folder adds about 2 MB (a 1.1 MB font index, a 563 KB
live-browser bundle). Without it, `SKILL.md`'s "Launcher unavailable"
path applies: the skill says context loading did not run and reads the
project files directly. Lost with it: the design detector and its
hook, the live browser panel, `pin`, and the font index. Don't run the
`npx impeccable …` commands some references suggest; they fetch the
same engine from npm.

Also dropped: upstream's per-harness builds for other agents and
everything outside the skill folder (CLI, extension, tests, demos).

## Updating

Re-vendor at a new pin, in both `.claude/skills/` and `.agents/skills/`,
and update the commits above. Never edit the copies.
