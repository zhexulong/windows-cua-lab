import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGenericPlannerInstruction } from '../apps/runner/src/generic-planner-instruction.ts';

test('generic planner guidance prefers higher-information visible state changes over low-change color clicks', () => {
  const instruction = buildGenericPlannerInstruction({
    targetApp: 'mspaint.exe',
    task: 'Find one low-risk interaction that produces a clearly observable UI state change and record the full evidence chain.'
  });

  assert.match(instruction, /prefer actions that create a clear, visible, and verifiable UI change/i);
  assert.match(instruction, /prefer tool switches, panel toggles, tab changes, dialog opens, or obvious selection highlights/i);
  assert.match(instruction, /avoid low-information actions such as color swatch clicks/i);
  assert.match(instruction, /prefer reversible actions when possible/i);
});
