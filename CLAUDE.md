# Git / CI workflow — standing authorization

- Never push directly to `develop` or `main` — always a feature/fix branch + PR (Forgejo `origin` is primary; GitHub `github` remote is a secondary mirror).
- Committing to a feature branch is pre-authorized — do it autonomously, no need to ask first.
- Merging a PR into `develop` is pre-authorized **once its CI has actually finished and shows green** (both Backend CI and Frontend + MCP CI checks passing) — do this autonomously too, no need to stop for a per-merge confirmation.
- Do NOT merge a PR whose CI is still pending, unknown, or failing. Investigate/fix and wait for green first.
- Merging `develop` into `main` (a release) still needs an explicit go-ahead each time — that one is not pre-authorized by this file.
