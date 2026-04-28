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

Capture the active desktop or a bounded window region and return a materialized screenshot artifact.

Required action fields:

- `kind: "screenshot"`
- `scope: "desktop" | "window" | "region"`

Optional action fields:

- `target` to name a logical window or region target

Successful `screenshot` responses are stricter than generic artifact-producing actions:

- `artifacts` must include one artifact with `kind: "screenshot"`
- that screenshot artifact must include both:
  - stable `ref`
  - inline `contentBase64`
- `stateHandle.screenshotRef` may still echo the screenshot identity, but it does not replace the artifact payload

If a broker reports `status: "executed"` for `kind: "screenshot"` but omits the screenshot artifact, `ref`, or `contentBase64`, consumers must treat that as a contract violation rather than a healthy success.

### `click`

Execute a bounded pointer click.

Required action fields:

- `kind: "click"`
- `position` with `x` and `y`
- `button: "left" | "right" | "middle"`

### `double_click`

Execute a bounded pointer double click atomically in one broker invocation.

Required action fields:

- `kind: "double_click"`
- `position` with `x` and `y`
- `button: "left" | "right" | "middle"`

### `type`

Type bounded text into the currently focused target.

Required action fields:

- `kind: "type"`
- `text`

### `keypress`

Press a bounded keyboard shortcut.

Required action fields:

- `kind: "keypress"`
- `keys` as a non-empty array of strings

### `move`

Move the cursor to a bounded position without clicking.

Required action fields:

- `kind: "move"`
- `position` with `x` and `y`

### `scroll`

Execute a bounded scroll gesture, optionally anchored to a target-relative position.

Required action fields:

- `kind: "scroll"`
- `delta_x`
- `delta_y`

Optional action fields:

- `position` with `x` and `y`
- `keys` as a modifier array

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
- `keys` when `kind` is `keypress`
- `button` and `position` when `kind` is `click`
- `button` and `position` when `kind` is `double_click`
- `position` when `kind` is `move`
- `delta_x` and `delta_y` when `kind` is `scroll`
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

For screenshot-contract failures, the canonical top-level family is:

- `broker_screenshot_contract_violation`

Consumers may preserve finer-grained leaf detail such as:

- `broker_screenshot_missing_artifact`
- `broker_screenshot_missing_ref`
- `broker_screenshot_missing_base64`

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
