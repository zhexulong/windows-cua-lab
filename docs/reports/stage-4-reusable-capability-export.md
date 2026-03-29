# Stage 4 Report: Reusable Capability Export

## Goal

Define the reusable contract surface that the standalone Windows CUA Lab can export back to `Vibe-Building-Your-Own-X` without coupling the lab to the main system's package graph, release cadence, or runtime assumptions.

## Exported capability surface

### 1. Transition envelope

- Source artifact: `schemas/transition-envelope.json`
- Shared concept: per-step execution history
- Exported fields:
  - action
  - before screenshot/state handle
  - after screenshot/state handle
  - verification result
  - provenance (`computer_use`, `native_adapter`, `hybrid`)
  - safety event
- Consumer use: downstream orchestration can ingest each transition as a normalized step record without importing lab runtime code.

### 2. Replay trace

- Source artifact: `schemas/replay-trace.json`
- Shared concept: run-level replay artifact format
- Exported fields:
  - step screenshots
  - action trace
  - verifier trace
  - summary report
  - target metadata
  - safety event log
- Consumer use: downstream systems can archive, inspect, or score a complete run with stable references to screenshots and logs.

### 3. State summary

- Source artifact: `schemas/reusable-state-summary.json`
- Shared concept: hypothesis-friendly state summary
- Exported fields:
  - `stateLabel`
  - `confidence`
  - `status` (`known`, `unknown`, `conflicted`)
  - `evidenceRefs`
  - `unknownMarkers`
  - `conflicts`
  - `sourceTransitionIds`
- Consumer use: downstream planners can carry forward summarized state beliefs without re-reading raw screenshots every time.

### 4. Safety event log

- Source artifact: `schemas/replay-trace.json` → `safetyEvents`
- Shared concept: action gate decisions and blocked/review-required outcomes
- Exported fields:
  - decision
  - reason
  - transition linkage
- Consumer use: downstream workflows can explain why an action was allowed, blocked, or escalated for review.

## Mapping to current lab artifacts

| Export concept | Current lab artifact | Notes |
| --- | --- | --- |
| Transition envelope | `schemas/transition-envelope.json` | Self-owned schema; no monorepo package dependency |
| Replay trace | `schemas/replay-trace.json` | Captures screenshots, traces, summary report, and safety events |
| State summary | `schemas/reusable-state-summary.json` | Added in Stage 4 as the lab-owned reusable summary contract |
| Safety event log | `replayTrace.safetyEvents` | Already emitted by Stage 2 and Stage 3 runs |

## What remains lab-only

The following remain internal to this repository and are not part of the reusable export contract:

- Windows broker startup scripts and staging details
- local gateway transport adaptation between `/v1/responses` and `/v1/chat/completions`
- demo-target definitions in `configs/demo-targets.json`
- app-specific run reports for Paint and Calculator

These can evolve independently as long as the exported contract shapes remain stable.

## Decoupling rules

- Do not import `desktop-discovery-modeling` packages directly.
- Do not require `Vibe-Building-Your-Own-X` to run the lab's broker or scripts just to read exported artifacts.
- Do not encode stage-specific assumptions into exported schema IDs or field names.
- Preserve WSL-initiated, Windows-executed operational conventions as documentation, not consumer requirements.

## Consumption sketch for Vibe-Building-Your-Own-X

`Vibe-Building-Your-Own-X` can consume the export contract in three layers:

1. **Transition import** — ingest each transition envelope as a normalized step record.
2. **Replay import** — attach screenshots, verifier traces, and summary reports to a run record.
3. **State-summary import** — store compact state hypotheses that reference transition IDs and evidence refs.

This keeps the relationship as: **shared contract shape, separate execution product**.

## Validation summary

Stage 4 is complete when:

- `schemas/reusable-state-summary.json` exists and defines the reusable summary contract,
- this report documents what is exported back and what remains lab-only,
- and `README.md` points readers to the reusable export contract.
