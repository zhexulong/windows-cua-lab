# Stage 2 Report: Paint-first Computer Use Demo

## Goal

Demonstrate a Paint-first computer-use loop that captures screenshots, plans an action with GPT-5.4-compatible input, executes the action through a bounded broker path, and persists replay artifacts.

## Run summary

- Mode: mock
- Task: In Microsoft Paint, make one visible diagonal mark using a bounded drag action.
- AI source: ai
- AI transport: chat.completions
- Broker bring-up command: powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File windows-broker/scripts/start-desktop-broker.ps1
- Broker bring-up note: Mock mode uses an in-process canvas instead of Windows actuation.

## Replay artifacts

- Summary report: docs/reports/stage-2-paint-demo.md
- Screenshots:
  - screenshots/step-0-before.png
  - screenshots/step-1-after.png
- Action trace: action-trace.jsonl
- Verifier trace: verifier-trace.jsonl

## Verification status

- Replay status: completed
- Verification passed: yes

## Notes

- Mock mode uses an in-process canvas instead of Windows actuation.

## Real pipeline reminder

Mock mode is only for local validation. The real pipeline is the `--mode real` path, which uses:

- `URL` / `KEY` for the GPT-5.4-compatible API gateway,
- automatic transport selection between `/v1/responses` and `/v1/chat/completions` based on gateway capabilities,
- `WINDOWS_BROKER_ENDPOINT` for the Windows broker,
- and WSL-triggered `powershell.exe` broker bring-up.
