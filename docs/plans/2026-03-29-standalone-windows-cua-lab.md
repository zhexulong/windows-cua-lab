# Standalone Windows CUA Lab Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone Windows Computer Use Lab that uses GPT-5.4 to observe, act on, and verify real Windows desktop software through a bounded broker, before deciding how to embed those capabilities into `Vibe-Building-Your-Own-X`.

**Architecture:** Keep this lab independent from the main repo. Use a Windows-side broker for bounded execution and screenshot capture, a GPT-5.4-driven computer-use loop for reasoning and action selection, and a replay/trace system for verification. Borrow concepts from `desktop-discovery-modeling` but do not couple directly to its monorepo lifecycle.

**Tech Stack:** TypeScript/Node runner, Windows-side broker (C# / FlaUI or equivalent bounded runtime), GPT-5.4 computer-use API, replay artifacts, JSON traces.

**Target Repository:** `git@github.com:zhexulong/windows-cua-lab.git`

**Important note:** Every stage in this plan must end with:

1. verification,
2. commit,
3. push to `git@github.com:zhexulong/windows-cua-lab.git`,
4. and only then begin the next stage.

Do not modify git author config. Use the current user identity already configured in the working repository.

### WSL / Windows execution rule

This lab is expected to be orchestrated from **WSL**.

That means:

- stage commands should be initiated from the WSL shell,
- Windows-specific work should be launched from WSL via `powershell.exe` (or equivalent Windows entrypoints),
- and operator instructions should prefer **WSL-initiated Windows execution** over “open a separate Windows terminal and run things manually.”

In other words:

> The operator lives in WSL; Windows hosts the broker and desktop-facing runtime.

All stage runbooks should make this boundary explicit.

---

## Product Positioning

This lab is **not** the main reconstruction system.

It exists to answer a narrower question:

> How far can GPT-5.4 computer use go on real Windows desktop software when it is the dominant observation/action layer, while still running inside a bounded broker and safety policy?

The lab should remain independent until it proves stable value.

---

## Reusable Interface Back to Vibe-Building-Your-Own-X

Even though this lab is standalone, it should expose reusable artifacts and interfaces that the main system can later consume.

### Required reusable capability surface

1. **Common transition envelope**
   - action
   - before screenshot/state handle
   - after screenshot/state handle
   - verification result
   - provenance (`computer_use`, `native_adapter`, or `hybrid`)

2. **Replay artifact format**
   - step screenshots
   - action trace
   - verifier trace
   - summary report

3. **Hypothesis-friendly state summary**
   - state label
   - confidence
   - unknown/conflicted markers
   - supporting evidence references

4. **Safety event log**
   - action gate decisions
   - blocked action reasons
   - human-review flags if introduced later

### What must stay decoupled

- do not depend directly on `desktop-discovery-modeling` package imports,
- do not assume monorepo-only scripts,
- do not require the main repo's release cadence,
- and do not assume the main repo's Stage sequencing.

The relationship should be: **shared contract shape, separate execution product**.

---

## Demo Targets

### Primary showcase target

- **Paint (`mspaint.exe`)**

Why:

- strongest visible feedback,
- best human-understandable demo of computer use,
- lower dependence on accessibility quality,
- and good fit for screenshot-first reasoning.

### Secondary validation target

- **Calculator (`CalculatorApp.exe`)**

Why:

- deterministic outcomes,
- crisp state transitions,
- and useful as a technical verification app for state-reading and verification quality.

### Out of scope initially

- browsers,
- File Explorer file moves/deletes,
- system settings mutations,
- login/account/network flows,
- destructive file operations.

---

## Safety Model

### Allowed in the first lab stages

- screenshot capture,
- bounded click,
- bounded type,
- bounded hotkey,
- bounded drag,
- visual verification,
- replay artifact generation.

### Forbidden in the first lab stages

- raw PowerShell passthrough,
- arbitrary shell execution,
- delete/overwrite outside an explicit sandbox,
- registry mutation,
- process kill,
- uncontrolled browser/system navigation.

### File safety rule

If any stage later touches files, the only allowed root is:

```text
E:\projects\desktop-discovery-lab-temp
```

Any file operation outside that root must be refused.

---

## Broker Extraction Checklist

The standalone lab should **start from** the proven `desktop-discovery-modeling/windows-broker` implementation, but it must not blindly copy the entire parent project shape.

Use the checklist below before or during `Task CUA-1`.

### Copy directly (high-confidence seed files)

These files are good candidates to copy as the initial Windows broker seed because they encode the already-proven Windows execution boundary.

- `desktop-discovery-modeling/windows-broker/contract.md`
- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/DesktopBroker.csproj`
- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/Program.cs`
- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/BrokerOptions.cs`
- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/BrokerRequestHandler.cs`
- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/Models/BrokerRequestEnvelope.cs`
- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/Models/BrokerResponseEnvelope.cs`
- `desktop-discovery-modeling/windows-broker/scripts/start-desktop-broker.ps1`
- `desktop-discovery-modeling/windows-broker/scripts/stop-desktop-broker.ps1`
- `desktop-discovery-modeling/windows-broker/scripts/test-desktop-broker.ps1`

### Copy, but adapt immediately

These files contain good logic, but they are shaped by the main repo’s UIA-first discovery system and should be adapted rather than mirrored blindly.

- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/FlaUi/FlaUiSession.cs`
  - Keep as the Windows-side automation/session core.
  - Adapt naming/comments away from Stage 7/Notepad assumptions.

- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/FlaUi/ActionService.cs`
  - Keep the bounded action model.
  - Adapt the allowed action set for the CUA lab (Paint/Calculator focus).

- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/FlaUi/VerificationService.cs`
  - Keep as the deterministic-verification substrate.
  - Adapt it so it coexists with AI-majority screenshot verification rather than assuming UIA-first acceptance.

- `desktop-discovery-modeling/windows-broker/src/DesktopBroker/FlaUi/ElementRegistry.cs`
  - Keep if useful for stable handles.
  - Simplify if the lab starts more screenshot-first than UIA-first.

- `desktop-discovery-modeling/windows-broker/README.md`
  - Rewrite around `windows-cua-lab` goals.
  - Do not leave Stage 7/8/Notepad-specific operator language in place.

### Do not copy directly (reimplement or leave out)

These parts are too tied to the main repository’s staged acceptance flow and should not be brought over as-is.

- Stage-specific Notepad/Calculator reports from `desktop-discovery-modeling/docs/reports/`
- Stage-specific checklists from `desktop-discovery-modeling/docs/checklists/`
- Main-repo implementation plan content from `desktop-discovery-modeling/docs/plans/`
- Main-repo package imports from `packages/desktop-discovery`, `packages/desktop-modeling`, or `packages/desktop-runner`
- Any path or naming convention that assumes `desktop-discovery-modeling` is the host repo

### Reimplement conceptually, not by copy-paste

These ideas are valuable, but the standalone lab should carry them as concepts rather than as tight source dependencies.

- **Transition envelope**
  - Recreate the shape used by the main repo’s `desktop-ir`, but keep the lab’s schema self-owned.

- **Replay artifact format**
  - Recreate the artifact layout in a lab-friendly way.

- **Action risk gating**
  - Preserve the allowlist / denylist / destructive-block concepts.

- **Evidence-tiered verification**
  - Preserve the idea that AI observations are evidence, not ungoverned truth.

### Preserve these invariants during extraction

- Keep the Windows broker as a **single actuation choke point**.
- Keep WSL as the **operator/orchestrator shell**.
- Keep all Windows-specific execution launched from WSL via `powershell.exe` or equivalent Windows entrypoints.
- Keep raw script text outside the normal transport boundary.
- Keep all side effects traceable through structured logs.

### Extraction acceptance check

The extraction should be considered successful only if:

- the new lab broker can start independently of the main repo,
- the new lab broker can answer `health`,
- the copied/adapted contract no longer references Stage 7/Stage 8/Notepad-specific acceptance wording,
- and the lab can evolve without importing main-repo packages directly.

---

## Stage 1 - Broker and Trace Skeleton

### Task CUA-1: Scaffold standalone Windows broker and trace format

**Files:**
- Create: `README.md`
- Create: `windows-broker/README.md`
- Create: `windows-broker/contract.md`
- Create: `schemas/transition-envelope.json`
- Create: `schemas/replay-trace.json`
- Create: `docs/reports/stage-1-broker-skeleton.md`

**Step 1: Write the failing test**

Create a failing validation step that requires the standalone repo to define:

- a broker contract,
- a transition envelope,
- and a replay trace schema.

Example checks:

```bash
test -f windows-broker/contract.md
test -f schemas/transition-envelope.json
test -f schemas/replay-trace.json
```

**Step 2: Run test to verify it fails**

Run:

```bash
test -f windows-broker/contract.md
test -f schemas/transition-envelope.json
test -f schemas/replay-trace.json
```

Expected: FAIL until the skeleton exists.

**Step 3: Write minimal implementation**

Define:

- the standalone broker contract,
- the common transition envelope,
- the replay trace schema,
- and the Stage 1 report.

**Step 4: Run test to verify it passes**

Run the same checks and confirm PASS.

Where these checks require Windows-specific behavior later, invoke them from WSL through `powershell.exe` instead of assuming a separately managed Windows terminal.

**Step 5: Commit and push**

```bash
git add README.md windows-broker/README.md windows-broker/contract.md schemas/transition-envelope.json schemas/replay-trace.json docs/reports/stage-1-broker-skeleton.md
git commit -m "feat: scaffold windows cua lab broker and trace contracts"
git push -u origin <branch-name>
```

---

## Stage 2 - Paint Computer-Use Demo

### Task CUA-2: Implement Paint-first CUA loop with replay artifacts

**Files:**
- Create: `apps/runner/src/main.ts`
- Create: `apps/runner/src/loop.ts`
- Create: `apps/runner/src/verifier.ts`
- Create: `apps/runner/src/traces.ts`
- Create: `docs/reports/stage-2-paint-demo.md`

**Step 1: Write the failing test**

Add a failing test or verification script requiring a run to produce:

- multiple screenshots,
- at least one executed action,
- and a replay trace.

**Step 2: Run test to verify it fails**

Run the trace checks and confirm they fail before implementation.

**Step 3: Write minimal implementation**

Implement the smallest runnable CUA loop for Paint that can:

- capture a screenshot,
- send the task and screenshot to GPT-5.4,
- execute bounded actions through the broker,
- capture the next screenshot,
- and persist replay artifacts.

Use Paint to demo visible spatial actions, not file writes.

**Step 4: Run test to verify it passes**

Verify:

- replay artifacts exist,
- action trace exists,
- screenshots change across steps,
- and the Stage 2 report is written.

The broker/runtime bring-up for this stage should be triggered from WSL through Windows commands, not treated as a fully manual Windows-only operator path.

**Step 5: Commit and push**

```bash
git add apps/runner/src docs/reports/stage-2-paint-demo.md
git commit -m "feat: add paint-first computer use demo loop"
git push origin <branch-name>
```

---

## Stage 3 - Calculator Deterministic Validation

### Task CUA-3: Add Calculator validation path for state reading and verification

**Files:**
- Modify: `apps/runner/src/loop.ts`
- Modify: `apps/runner/src/verifier.ts`
- Create: `docs/reports/stage-3-calculator-validation.md`
- Create: `configs/demo-targets.json`

**Step 1: Write the failing test**

Add a failing validation requiring Calculator runs to record:

- one state change,
- one deterministic result read,
- and one verification outcome.

**Step 2: Run test to verify it fails**

Run the Calculator validation checks and confirm they fail before implementation.

**Step 3: Write minimal implementation**

Implement a Calculator path that demonstrates:

- mode or view switching,
- deterministic state reading,
- and verification logic stronger than pure Paint visual similarity.

This stage exists to prove the lab can do more than a “wow demo.”

**Step 4: Run test to verify it passes**

Verify:

- a Calculator run report exists,
- verification traces exist,
- and deterministic state/result checks pass.

This validation should also follow the WSL-orchestrated, Windows-executed pattern.

**Step 5: Commit and push**

```bash
git add apps/runner/src/verifier.ts apps/runner/src/loop.ts docs/reports/stage-3-calculator-validation.md configs/demo-targets.json
git commit -m "feat: add calculator validation path for windows cua lab"
git push origin <branch-name>
```

---

## Stage 4 - Reusable Capability Export Back to Vibe-Building-Your-Own-X

### Task CUA-4: Define reusable export contract for future integration

**Files:**
- Create: `docs/reports/stage-4-reusable-capability-export.md`
- Create: `schemas/reusable-state-summary.json`
- Modify: `README.md`

**Step 1: Write the failing test**

Add a failing validation requiring the lab to define:

- what is exported back,
- how it maps to shared concepts,
- and what remains lab-only.

**Step 2: Run test to verify it fails**

Run the schema/report existence checks and confirm they fail before implementation.

**Step 3: Write minimal implementation**

Define the reusable export contract for:

- transition envelope,
- replay trace,
- state summary,
- safety event log,

and explicitly describe how these could later be consumed by `Vibe-Building-Your-Own-X` without forcing immediate integration.

**Step 4: Run test to verify it passes**

Verify schema/report existence and consistency.

If this stage introduces helper scripts, they should likewise assume WSL-initiated invocation of Windows-side programs.

**Step 5: Commit and push**

```bash
git add docs/reports/stage-4-reusable-capability-export.md schemas/reusable-state-summary.json README.md
git commit -m "docs: define reusable capability export for vibe-building integration"
git push origin <branch-name>
```

---

## Stage Summary

### Stage 1 Outcome

The lab has a standalone broker/trace contract and can evolve independently from the main repo.

### Stage 2 Outcome

The lab can demonstrate obvious computer-use capability on a visually rich Windows app (Paint).

### Stage 3 Outcome

The lab can verify more deterministic state-reading and validation behavior on Calculator.

### Stage 4 Outcome

The lab exposes reusable capability contracts back to `Vibe-Building-Your-Own-X` without being embedded into it yet.

### Operational convention

Across all stages, prefer documenting commands in one of these forms:

```bash
powershell.exe -NoLogo -NoProfile -Command "..."
```

or:

```bash
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File <windows-script.ps1>
```

instead of assuming the operator is already working inside a Windows-native shell.

---

## Required Git Rule

Every stage above is blocked on:

1. verification,
2. commit,
3. push to `git@github.com:zhexulong/windows-cua-lab.git`,
4. and only then proceeding to the next stage.

Do not skip the push step.
