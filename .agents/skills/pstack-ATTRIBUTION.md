# pstack vendored skills — attribution and pin

Upstream: https://github.com/backnotprop/pstack (standalone mirror of
Cursor's pstack plugin, for use in any agent harness).
Pinned commit: `3a604672c46cd8187d2b19980eae0a34f9f91138` (upstream `main`
at vendor time). All files below are verbatim copies at that commit.

License: MIT License, Copyright (c) 2026 Lauren Tan. Permission is hereby
granted, free of charge, to deal in the Software without restriction,
subject to including this copyright and permission notice in all copies.
See the upstream LICENSE for the full text.

## Vendored slice

how, why, interrogate, unslop, technical-writing, reflect (each
SKILL.md + references/), and principles laziness-protocol,
foundational-thinking, model-the-domain, boundary-discipline,
type-system-discipline, prove-it-works, fix-root-causes,
sequence-verifiable-units, test-behavior-not-implementation,
guard-the-context-window.

## Deliberate drops at this pin

pstack's process layer: poteto-mode (all playbooks), tdd and no-comments.
Superpowers owns the development process in this repo, and no-comments
would strip the explanatory comments AGENTS.md asks for (see AGENTS.md,
"Agent skills"). Also dropped: the other fourteen principle files and all
non-listed skills, among them architect (it needs the unvendored arena). A pointer to a dropped file resolves to nothing by
design; the autopilot wiring only names vendored skills.
