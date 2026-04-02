import test from 'node:test';
import assert from 'node:assert/strict';

import { validateGenericPlannerAction } from '../apps/runner/src/generic-planner-constraints.ts';

test('rejects second-pass hotkeys that violate target continuity', () => {
  const violation = validateGenericPlannerAction({
    kind: 'hotkey',
    keys: ['CTRL', '1'],
    target: 'termius.exe',
  }, 'termius.exe', {
    second_pass_context: {
      preferred_target_continuity: true,
      preferred_target_ref: "Host card 'wsl2204'",
      disallow_global_app_actions: true,
      allowed_next_action_kinds: ['click', 'double_click', 'hotkey'],
      allowed_hotkeys: ['ENTER'],
    },
  });

  assert.match(violation ?? '', /violates second-pass target continuity/i);
});

test('allows Enter on the selected target as a bounded second-pass action', () => {
  const violation = validateGenericPlannerAction({
    kind: 'hotkey',
    keys: ['ENTER'],
    target: "Host card 'wsl2204'",
  }, 'termius.exe', {
    second_pass_context: {
      preferred_target_continuity: true,
      preferred_target_ref: "Host card 'wsl2204'",
      disallow_global_app_actions: true,
      allowed_next_action_kinds: ['click', 'double_click', 'hotkey'],
      allowed_hotkeys: ['ENTER'],
    },
  });

  assert.equal(violation, undefined);
});
