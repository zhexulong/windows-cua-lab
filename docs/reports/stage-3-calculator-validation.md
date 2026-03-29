# Stage 3 Report: Calculator Deterministic Validation

## Goal

Demonstrate a Calculator path that produces a deterministic result, reads that result, and verifies the outcome with stronger logic than simple visual-diff checks.

## Run summary

- Mode: mock
- Task: In Windows Calculator, compute 12 + 34 and show the final result.
- Expected result: 46
- Actual result: 46
- Broker bring-up command: powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File windows-broker/scripts/start-desktop-broker.ps1
- Broker bring-up note: Mock mode uses an in-process calculator canvas instead of Windows actuation.

## Replay artifacts

- Summary report: docs/reports/stage-3-calculator-validation.md
- Screenshots:
  - screenshots/step-0-before.png
  - screenshots/step-1-after.png
- Action trace: action-trace.jsonl
- Verifier trace: verifier-trace.jsonl

## Verification status

- Replay status: completed
- Verification passed: yes

## Notes

- Mock mode uses an in-process calculator canvas instead of Windows actuation.
