import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGenericPlannerInstruction } from '../apps/runner/src/generic-planner-instruction.ts';

test('generic planner guidance prefers higher-information visible state changes over low-change color clicks', () => {
  const instruction = buildGenericPlannerInstruction({
    targetApp: 'mspaint.exe',
    task: 'Find one low-risk interaction that produces a clearly observable UI state change and record the full evidence chain.'
  });

  assert.match(instruction, /click\|double_click\|type\|keypress\|move\|scroll\|drag\|wait/i);
  assert.match(instruction, /prefer actions that create a clear, visible, and verifiable UI change/i);
  assert.match(instruction, /prefer tool switches, panel toggles, tab changes, dialog opens, or obvious selection highlights/i);
  assert.match(instruction, /avoid low-information actions such as color swatch clicks/i);
  assert.match(instruction, /prefer reversible actions when possible/i);
});

test('generic planner guidance prefers target continuity when a previous pass already selected a plausible target', () => {
  const instruction = buildGenericPlannerInstruction({
    targetApp: 'termius.exe',
    task: [
      'Original goal: confirm host session entry',
      "Previous action: click on Host card 'wsl2204'",
      'Likely failure mode: selection_without_activation',
      'Allowed next action families: click, double_click, keypress:Enter',
      'Preferred target continuity: reuse the same selected target if plausible.',
    ].join('\n')
  });

  assert.match(instruction, /prefer reusing that same target for bounded re-activation before switching to unrelated app-level actions/i);
  assert.match(instruction, /allow app-level activation actions such as enter when they continue the same entry goal/i);
  assert.match(instruction, /avoid unrelated global app-level actions or keypresses that do not continue the same entry goal/i);
  assert.match(instruction, /prefer mouse-based re-activation on the same target before app-level activation like enter when both are plausible/i);
});

test('generic planner guidance can surface structured second-pass planner context', () => {
  const instruction = buildGenericPlannerInstruction({
    targetApp: 'termius.exe',
    task: 'Original goal: confirm host session entry',
    plannerContext: {
      second_pass_context: {
        preferred_target_continuity: true,
        preferred_target_ref: "Host card 'wsl2204'",
        allow_app_level_activation: true,
        allowed_next_action_kinds: ['click', 'double_click', 'keypress'],
        allowed_keypresses: ['ENTER'],
      },
    },
  });

  assert.match(instruction, /Structured planner context/i);
  assert.match(instruction, /preferred_target_continuity/i);
  assert.match(instruction, /allow_app_level_activation/i);
  assert.match(instruction, /allowed_keypresses/i);
});
