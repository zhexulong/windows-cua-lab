# Stage 1 Report: Broker and Trace Skeleton

## Goal

Establish the standalone broker and trace contracts required for later Windows computer-use stages.

## Deliverables created

- `README.md`
- `windows-broker/README.md`
- `windows-broker/contract.md`
- `schemas/transition-envelope.json`
- `schemas/replay-trace.json`
- `docs/reports/stage-1-broker-skeleton.md`

## What Stage 1 defines

1. A bounded Windows broker contract for screenshot and UI action execution.
2. A reusable transition envelope that records action, before/after state handles, provenance, and verification outcome.
3. A replay trace schema that aggregates screenshots, traces, safety events, and run summary.
4. A WSL-orchestrated operating model for Windows-side broker bring-up.
5. A canonical action shape shared by the broker contract and the persisted transition envelope.

## Validation workflow

Initial existence checks were run before implementation and failed because the Stage 1 files did not yet exist.

After implementation, rerun:

```bash
test -f windows-broker/contract.md
test -f schemas/transition-envelope.json
test -f schemas/replay-trace.json
```

Observed result: all checks pass locally.

Local validation also parses the JSON schema files to confirm they are well-formed JSON documents.

Validation evidence:

```bash
test -f windows-broker/contract.md \
  && test -f schemas/transition-envelope.json \
  && test -f schemas/replay-trace.json \
  && test -f README.md \
  && test -f windows-broker/README.md \
  && test -f docs/reports/stage-1-broker-skeleton.md
python - <<'PY'
import json
from pathlib import Path
for rel in ['schemas/transition-envelope.json', 'schemas/replay-trace.json']:
    with Path(rel).open() as f:
        json.load(f)
    print(f'OK {rel}')
PY
```

Observed output:

```text
OK schemas/transition-envelope.json
OK schemas/replay-trace.json
```

## Notes

- This workspace has been initialized with `git init`, so the Stage 1 skeleton can now be tracked locally.
- Commit and push remain pending explicit user instruction and remote configuration.
- Later stages should preserve the same WSL-control-plane and Windows-runtime separation defined here.
