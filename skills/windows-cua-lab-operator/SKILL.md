---
name: windows-cua-lab-operator
description: Use when operating Windows CUA Lab runs from WSL or a lightly adapted Windows-native shell, especially to run demos, inspect replay artifacts, diagnose failures, and iterate toward stable behavior.
---

# Windows CUA Lab Operator

## Overview

This skill teaches an agent how to use `windows-cua-lab` as an iterative runtime and debugging surface rather than a one-shot demo runner.

Core principle: **run → replay → diagnose → refine → export**.

## When to Use

Use when:

- running Paint or Calculator demos,
- reading replay artifacts after a failed or partial run,
- deciding whether a failure is caused by perception, execution, verification, or environment,
- or preparing a stable capability export for a downstream host system.

Do not use when you need to modify the Windows broker internals without running any lab flow.

## Operating Pattern

### 1. Pick the narrowest entrypoint

Start with one of these:

- `npm run test:stage2` for Paint
- `npm run test:stage3` for Calculator

When real Windows execution exists, prefer the smallest real target that exercises one broker path clearly before expanding the task.

### 2. Inspect the produced artifacts

Always review:

- screenshots
- `action-trace.jsonl`
- `verifier-trace.jsonl`
- `replay-trace.json`
- the stage report in `docs/reports/`

For real Windows runs, also inspect:

- broker stdout/stderr logs
- Windows-side lifecycle script output
- the exact broker endpoint used

### 3. Classify the failure correctly

Use these buckets:

- **Perception** — the model misunderstood what was on screen
- **Execution** — the action did not happen as intended
- **Verification** — the action happened but success/failure was read incorrectly
- **Environment** — broker setup, shell boundary, or OS/runtime issue

### 4. Follow the runbook, not improvisation

Default operating order:

1. build the lab
2. start or verify the broker path
3. run the narrowest demo
4. inspect replay artifacts
5. classify the failure bucket
6. change one variable only

### 5. Refine one variable at a time

Good refinements:

- adjust prompt wording
- adjust target selection hints
- adjust verifier rule
- adjust replay output clarity

Bad refinements:

- changing prompt, broker, verifier, and task at once
- declaring success from one partial visual change
- skipping replay review

### 6. Export only after stability

Do not promote a run into reusable capability export until:

- the run is repeatable,
- the traces are understandable,
- and the exported contract remains decoupled from lab-only implementation details.

## WSL / Windows Rule

Default mode:

- operator in **WSL**
- Windows work launched via `powershell.exe`

Windows-native shell use is allowed after light adaptation, but the same broker boundary and replay expectations still apply.

## Quick Reference

| Goal | Command |
| --- | --- |
| Build lab | `npm run build` |
| Paint demo | `npm run test:stage2` |
| Calculator demo | `npm run test:stage3` |
| Read stage reports | `docs/reports/` |
| Inspect replay artifacts | `artifacts/stage2-paint/` or `artifacts/stage3-calculator/` |

## Real Windows Runbook

Use this sequence once the real broker path exists:

1. Launch Windows-side broker from WSL via `powershell.exe`
2. Check broker health
3. Run the smallest real demo task
4. Inspect screenshots and traces
5. Only then widen the task scope

## Common Mistakes

- Treating one successful click as proof the system is stable
- Ignoring `verifier-trace.jsonl`
- Making multiple changes before replaying the previous run
- Confusing a visually interesting Paint result with deterministic correctness
- Exporting lab-specific details that downstream host systems should not depend on
- Treating mock-mode success as proof the real Windows path is correct
