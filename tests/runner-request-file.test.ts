import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';

import { resolveRunnerRequest } from '../apps/runner/src/runner-request.ts';
import { resolveGenericPlannerObjectiveText } from '../apps/runner/src/generic-planner-instruction.ts';

test('runner request file can provide target app, task, and planner context without separate CLI task flags', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'windows-cua-lab-request-file-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(
    requestFile,
    JSON.stringify({
      targetApp: 'notepad.exe',
      outputDir: 'artifacts/custom-notepad-request',
      reportPath: 'docs/reports/custom-notepad-request.md',
      windowTitle: 'Untitled - Notepad',
      structuredRequest: {
        intent: 'one_bounded_action',
        actionKind: 'click',
        targetSummary: 'Save button',
        expectedOutcome: 'Dialog opens',
      },
      plannerContext: {
        structured_request: {
          action_kind: 'click',
          target_summary: 'Save button',
          expected_outcome: 'Dialog opens',
        },
      },
    }, null, 2),
    'utf8',
  );

  const request = await resolveRunnerRequest({
    args: ['--target', 'any', '--mode', 'real', '--request-file', requestFile],
    env: {},
  });

  assert.equal(request.target, 'any');
  assert.equal(request.mode, 'real');
  assert.equal(request.targetApp, 'notepad.exe');
  assert.equal(request.outputDir, 'artifacts/custom-notepad-request');
  assert.equal(request.reportPath, 'docs/reports/custom-notepad-request.md');
  assert.equal(request.task, undefined);
  assert.equal(request.windowTitle, 'Untitled - Notepad');
  assert.deepEqual(request.plannerContext, {
    structured_request: {
      intent: 'one_bounded_action',
      action_kind: 'click',
      target_summary: 'Save button',
      expected_outcome: 'Dialog opens',
    },
  });
});

test('runner objective text prefers request-file task over reconstructed structured summary', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'windows-cua-lab-request-file-task-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(
    requestFile,
    JSON.stringify({
      targetApp: 'termius.exe',
      task: 'Use one bounded action to reactivate the existing Termius session entry for host 4090x4.',
      structuredRequest: {
        intent: 'one_bounded_action',
        actionKind: 'click',
        targetSummary: 'existing Termius session entry',
        expectedOutcome: 'the session tab becomes active',
      },
    }, null, 2),
    'utf8',
  );

  const request = await resolveRunnerRequest({
    args: ['--target', 'any', '--mode', 'real', '--request-file', requestFile],
    env: {},
  });

  const objectiveText = resolveGenericPlannerObjectiveText({
    targetApp: request.targetApp ?? 'termius.exe',
    task: request.task,
    plannerContext: request.plannerContext,
  });

  assert.equal(objectiveText, 'Use one bounded action to reactivate the existing Termius session entry for host 4090x4.');
});
