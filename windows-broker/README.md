# Windows Broker

The Windows broker is the bounded execution surface between the model-driven runner and the Windows desktop.

## Responsibilities

- capture screenshots and return stable artifact handles,
- execute bounded UI actions,
- enforce safety policy before any action is executed,
- emit enough metadata for replay and verification.

## Initial bounded action set

Stage 1 defines the contract for these action families:

- `screenshot`
- `click`
- `double_click`
- `type`
- `hotkey`
- `drag`

These actions are intentionally narrow so the runner can reason over a small, auditable capability surface.

`double_click` is a first-class bounded action aligned with GPT-5.4 computer use semantics. The broker executes it atomically in one invocation of the click script, rather than by orchestrating two delayed top-level click requests.

## WSL-orchestrated bring-up

Windows-side processes should be started from WSL, for example:

```bash
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\\windows-broker\\start-broker.ps1
```

The script above is illustrative; Stage 1 only defines the contract and operating expectations, not the full broker implementation.

## Safety posture

The broker must reject or block:

- arbitrary shell execution,
- registry mutation,
- destructive file operations outside an explicit sandbox,
- uncontrolled browser or system navigation,
- process termination requests.

All allow/deny decisions must be representable in replay artifacts.
