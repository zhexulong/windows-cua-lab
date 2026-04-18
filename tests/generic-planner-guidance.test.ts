import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGenericPlannerInstruction,
  buildGenericVerifierInstruction,
} from '../apps/runner/src/generic-planner-instruction.ts';

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
      'Available tools: click, double_click, keypress, type',
      'Preferred target continuity: reuse the same selected target if plausible.',
    ].join('\n')
  });

  assert.match(instruction, /prefer reusing that same target for bounded re-activation before switching to unrelated app-level actions/i);
  assert.match(instruction, /allow app-level activation actions such as enter when they continue the same entry goal/i);
  assert.match(instruction, /avoid unrelated global app-level actions or keypresses that do not continue the same entry goal/i);
  assert.doesNotMatch(instruction, /allowed next action families|allowed_keypresses/i);
});

test('generic planner guidance can surface structured second-pass planner context', () => {
  const instruction = buildGenericPlannerInstruction({
    targetApp: 'termius.exe',
    task: 'Original goal: confirm host session entry',
    plannerContext: {
      second_pass_context: {
        preferred_target_continuity: true,
        previous_target_ref: "Host card 'wsl2204'",
        allow_app_level_activation: true,
        tool_inventory: ['click', 'double_click', 'keypress', 'type'],
      },
    },
  });

  assert.match(instruction, /Structured planner context/i);
  assert.match(instruction, /preferred_target_continuity/i);
  assert.match(instruction, /allow_app_level_activation/i);
  assert.match(instruction, /tool_inventory/i);
  assert.match(instruction, /Available tools: click, double_click, keypress, type/i);
  assert.doesNotMatch(instruction, /allowed_keypresses|allowed_next_action_kinds/i);
});

test('generic planner guidance can derive a bounded objective from structured request context when task is omitted', () => {
  const instruction = buildGenericPlannerInstruction({
    targetApp: 'notepad.exe',
    plannerContext: {
      structured_request: {
        intent: 'one_bounded_action',
        action_kind: 'click',
        target_summary: 'Save button',
        expected_outcome: 'Dialog opens',
      },
    },
  });

  assert.match(instruction, /Structured request \(normalized JSON\):/i);
  assert.match(instruction, /Treat the structured request as authoritative\./i);
  assert.match(instruction, /Use the auxiliary objective summary only as a fallback gloss\./i);
  assert.match(instruction, /Auxiliary objective summary: .*click/i);
  assert.match(instruction, /"action_kind": "click"/i);
  assert.match(instruction, /Save button/i);
  assert.match(instruction, /Dialog opens/i);
  assert.match(instruction, /Structured planner context/i);
  const structuredIndex = instruction.indexOf('Structured request (normalized JSON):');
  const summaryIndex = instruction.indexOf('Auxiliary objective summary:');
  assert.equal(structuredIndex >= 0, true);
  assert.equal(summaryIndex > structuredIndex, true);
});

test('generic verifier guidance can consume structured request context without a task string', () => {
  const instruction = buildGenericVerifierInstruction({
    targetApp: 'notepad.exe',
    offsetMs: 500,
    actionKind: 'click',
    plannerContext: {
      structured_request: {
        intent: 'one_bounded_action',
        action_kind: 'click',
        target_summary: 'Save button',
        expected_outcome: 'Dialog opens',
        observation_binding: 'bound',
      },
    },
  });

  assert.match(instruction, /Structured request \(normalized JSON\):/i);
  assert.match(instruction, /Treat the structured request as authoritative\./i);
  assert.match(instruction, /Use the auxiliary objective summary only as a fallback gloss\./i);
  assert.match(instruction, /Auxiliary objective summary: .*click/i);
  assert.match(instruction, /"target_summary": "Save button"/i);
  assert.match(instruction, /"expected_outcome": "Dialog opens"/i);
  assert.match(instruction, /Action kind: click/i);
  assert.match(instruction, /Candidate screenshot offset: 500ms/i);
  const structuredIndex = instruction.indexOf('Structured request (normalized JSON):');
  const summaryIndex = instruction.indexOf('Auxiliary objective summary:');
  assert.equal(structuredIndex >= 0, true);
  assert.equal(summaryIndex > structuredIndex, true);
});
