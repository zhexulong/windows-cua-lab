import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';

import {
  resolveStructuredGenericPlannerDecision,
  runGenericDemo,
} from '../dist/apps/runner/src/loop.js';

test('resolveStructuredGenericPlannerDecision maps focus-path cua_type into a native broker type action', () => {
  const decision = resolveStructuredGenericPlannerDecision({
    targetApp: 'termius.exe',
    plannerContext: {
      operation: {
        toolName: 'cua_type',
        actionKind: 'type',
        text: 'echo structured-run',
        targetWindow: {
          process_name: 'termius.exe',
        },
      },
    },
  });

  assert.ok(decision);
  assert.equal(decision?.source, 'structured');
  assert.equal(decision?.plannerAttemptCount, 0);
  assert.equal(decision?.validation?.accepted, true);
  assert.equal(decision?.action.kind, 'type');
  assert.equal(decision?.action.text, 'echo structured-run');
  assert.equal(decision?.action.target, 'termius.exe');
});

test('resolveStructuredGenericPlannerDecision does not bypass AI grounding for bounded cua_scroll', () => {
  const decision = resolveStructuredGenericPlannerDecision({
    targetApp: 'notepad.exe',
    plannerContext: {
      operation: {
        toolName: 'cua_scroll',
        actionKind: 'scroll',
        deltaX: 0,
        deltaY: 480,
        regionHint: {
          label: 'Results pane',
          bounds: {
            x: 10,
            y: 20,
            width: 100,
            height: 60,
          },
        },
      },
    },
  });

  assert.equal(decision, undefined);
});

test('resolveStructuredGenericPlannerDecision does not bypass AI grounding for region-bounded cua_click', () => {
  const decision = resolveStructuredGenericPlannerDecision({
    targetApp: 'notepad.exe',
    plannerContext: {
      operation: {
        toolName: 'cua_click',
        actionKind: 'click',
        button: 'right',
        target: {
          text: 'Context menu anchor',
        },
        regionHint: {
          label: 'Editor surface',
          bounds: {
            x: 90,
            y: 30,
            width: 40,
            height: 20,
          },
        },
      },
    },
  });

  assert.equal(decision, undefined);
});

test('resolveStructuredGenericPlannerDecision does not bypass AI grounding for region-bounded cua_double_click', () => {
  const decision = resolveStructuredGenericPlannerDecision({
    targetApp: 'explorer.exe',
    plannerContext: {
      operation: {
        toolName: 'cua_double_click',
        actionKind: 'double_click',
        regionHint: {
          label: 'File row',
          bounds: {
            x: 200,
            y: 80,
            width: 80,
            height: 24,
          },
        },
      },
    },
  });

  assert.equal(decision, undefined);
});

test('resolveStructuredGenericPlannerDecision maps cua_press_key into a native broker keypress action', () => {
  const decision = resolveStructuredGenericPlannerDecision({
    targetApp: 'termius.exe',
    plannerContext: {
      operation: {
        toolName: 'cua_press_key',
        actionKind: 'press_key',
        keys: ['CTRL', 'L'],
      },
    },
  });

  assert.ok(decision);
  assert.equal(decision?.source, 'structured');
  assert.equal(decision?.action.kind, 'keypress');
  assert.deepEqual(decision?.action.keys, ['CTRL', 'L']);
  assert.equal(decision?.action.target, 'termius.exe');
});

test('resolveStructuredGenericPlannerDecision does not bypass AI grounding for region-bounded cua_drag', () => {
  const decision = resolveStructuredGenericPlannerDecision({
    targetApp: 'explorer.exe',
    plannerContext: {
      operation: {
        toolName: 'cua_drag',
        actionKind: 'drag',
        sourceRegionHint: {
          label: 'Source item',
          bounds: {
            x: 20,
            y: 40,
            width: 40,
            height: 20,
          },
        },
        destinationRegionHint: {
          label: 'Destination item',
          bounds: {
            x: 200,
            y: 100,
            width: 60,
            height: 30,
          },
        },
      },
    },
  });

  assert.equal(decision, undefined);
});

test('resolveStructuredGenericPlannerDecision declines target-bound cua_type that still needs visual grounding', () => {
  const decision = resolveStructuredGenericPlannerDecision({
    targetApp: 'notepad.exe',
    plannerContext: {
      operation: {
        toolName: 'cua_type',
        actionKind: 'type',
        text: 'hello',
        target: {
          text: 'Editor',
        },
        snapshotRef: 'openreverse://session/demo/cua/snapshots/shot-0001',
      },
    },
  });

  assert.equal(decision, undefined);
});

test('runGenericDemo uses structured operation routing before the AI planner path', async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'windows-cua-lab-structured-route-'));
  const previousDebug = process.env.FULL_APP_VERIFICATION_DEBUG;
  process.env.FULL_APP_VERIFICATION_DEBUG = '1';

  try {
    await runGenericDemo({
      mode: 'mock',
      outputDir,
      targetApp: 'termius.exe',
      startBrokerIfNeeded: false,
      plannerContext: {
        operation: {
          toolName: 'cua_type',
          actionKind: 'type',
          text: 'echo routed-before-ai',
          targetWindow: {
            process_name: 'termius.exe',
          },
        },
      },
    });

    const actionDecision = JSON.parse(await readFile(path.join(outputDir, 'action-decision.json'), 'utf8'));
    assert.equal(actionDecision.planner_source, 'structured');
    assert.equal(actionDecision.fallback_used, false);
    assert.equal(actionDecision.planner_attempt_count, 0);
    assert.equal(actionDecision.planner_action.kind, 'type');
    assert.equal(actionDecision.planner_action.text, 'echo routed-before-ai');
    assert.equal(actionDecision.executed_action.kind, 'type');
  } finally {
    if (previousDebug === undefined) {
      delete process.env.FULL_APP_VERIFICATION_DEBUG;
    } else {
      process.env.FULL_APP_VERIFICATION_DEBUG = previousDebug;
    }
  }
});
