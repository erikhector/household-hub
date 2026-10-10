# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# Repo-local copy for household-hub: every role runs on the session model.
# Copy this file to ~/.agents/pstack-models.md to apply it to interactive sessions.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit the subagent `model`).
# budget: large (xhigh)
feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: inherit-parent
hardest tasks: inherit-parent
how explorer: inherit-parent
how explainer: inherit-parent
why investigators: inherit-parent
why synthesizer: inherit-parent
reflect tooling: inherit-parent
reflect judgment, divergent, synthesizer: inherit-parent
arena runners: inherit-parent
arena cross-judge pool: inherit-parent
swarm workers: inherit-parent
architect runners: inherit-parent
interrogate reviewers: inherit-parent
