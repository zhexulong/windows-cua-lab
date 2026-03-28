# Windows CUA Lab

Standalone Windows Computer Use Automation (CUA) lab for exploring how GPT-5.4 can observe, act on, and verify real Windows desktop software through a bounded broker.

## Scope

This repository is intentionally independent from any parent monorepo. Its first responsibility is to define the contracts that later runtime implementations must follow:

- a Windows-side broker contract for bounded desktop actions,
- a transition envelope for step-by-step execution history,
- and a replay trace schema for persisted run artifacts.

## Operating model

The operator runs orchestration from **WSL**. Windows-specific behavior should be launched from WSL via commands such as:

```bash
powershell.exe -NoLogo -NoProfile -Command "..."
```

This keeps the control plane in WSL while the broker and desktop-facing runtime remain on Windows.

## Stage status

- Stage 1: broker and trace skeleton
- Stage 2: Paint-first demo loop
- Stage 3: Calculator validation path
- Stage 4: reusable capability export contract

## Repository layout

- `windows-broker/` — broker contract and Windows runtime notes
- `schemas/` — JSON schemas for transition and replay artifacts
- `docs/reports/` — stage reports and verification notes
- `docs/plans/` — implementation plans
