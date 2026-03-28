# Windows Broker Contract

## Purpose

Provide a stable, bounded interface for Windows desktop observation and action execution while preserving replayability and safety.

## Contract goals

1. Keep desktop control behind an explicit broker boundary.
2. Make every executable step serializable into a transition envelope.
3. Preserve enough evidence for post-run verification and audit.
4. Support WSL-initiated orchestration of Windows-side runtime components.

## Invocation boundary

- **Caller**: Node/TypeScript runner orchestrated from WSL.
- **Broker host**: Windows runtime process.
- **Transport**: implementation-defined (HTTP, named pipe, stdio bridge, etc.), but requests and responses must conform to the payload shapes below.

## Request envelope

Every broker request must include:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `requestId` | string | yes | Unique identifier for correlation and replay. |
| `sessionId` | string | yes | Groups all requests for a single run. |
| `action` | object | yes | Requested bounded action. |
| `policyContext` | object | yes | Safety constraints and sandbox metadata. |
| `expectedState` | object | no | Optional hints used by verification and preflight checks. |

## Supported action kinds

### `screenshot`

Capture the active desktop or a bounded window region and return an artifact handle.

Required action fields:

- `kind: "screenshot"`
- `scope: "desktop" | "window" | "region"`

Optional action fields:

- `target` to name a logical window or region target

### `click`

Execute a bounded pointer click.

Required action fields:

- `kind: "click"`
- `position` with `x` and `y`
- `button: "left" | "right" | "middle"`

### `type`

Type bounded text into the currently focused target.

Required action fields:

- `kind: "type"`
- `text`

### `hotkey`

Press a bounded keyboard shortcut.

Required action fields:

- `kind: "hotkey"`
- `keys` as a non-empty array of strings

### `drag`

Execute a bounded drag gesture.

Required action fields:

- `kind: "drag"`
- `from` with `x` and `y`
- `to` with `x` and `y`

## Canonical action payload shape

The transition envelope schema is the canonical persisted representation for broker actions. The broker request payload and replay payload must therefore use the same action field names:

- `kind`
- `scope` when `kind` is `screenshot`
- `target` as an optional logical target hint
- `text` when `kind` is `type`
- `keys` when `kind` is `hotkey`
- `button` and `position` when `kind` is `click`
- `from` and `to` when `kind` is `drag`

Any future extension to broker actions must first be added to `schemas/transition-envelope.json` so every executable step remains serializable without lossy field mapping.

## Policy context

`policyContext` must include:

- `allowedRoots`: file-system roots that later file actions may target,
- `blockedCapabilities`: explicitly forbidden broker capabilities,
- `operator`: logical caller identity,
- `requiresHumanReview`: whether the action is gated pending review.

For Stage 1, file mutation is not part of the allowed action set, but the contract reserves `allowedRoots` so future stages can remain explicit.

## Response envelope

Every broker response must include:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `requestId` | string | yes | Echoed request identifier. |
| `status` | string | yes | `executed`, `blocked`, or `failed`. |
| `startedAt` | string | yes | ISO-8601 timestamp. |
| `finishedAt` | string | yes | ISO-8601 timestamp. |
| `artifacts` | array | yes | Screenshot, log, or trace artifacts produced by the broker. |
| `stateHandle` | object | no | Handle to the resulting desktop state or screenshot. |
| `safetyEvent` | object | yes | Policy decision and rationale. |
| `error` | object | no | Present when `status` is `failed`. |

## Replay linkage

The broker contract is complete only when each executed or blocked action can be represented in `schemas/transition-envelope.json` and aggregated by `schemas/replay-trace.json`.

Every transition must include its `safetyEvent`, and each replay trace must also carry a top-level `safetyEvents` aggregation for audit-friendly review.

## Out of scope in Stage 1

- raw PowerShell passthrough,
- arbitrary shell execution,
- destructive file operations,
- registry mutation,
- process kill,
- full implementation of the transport or runtime host.
