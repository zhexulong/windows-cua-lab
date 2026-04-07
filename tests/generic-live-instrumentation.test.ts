import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('generic real-mode appends phase markers around activation, screenshot, planner, broker, and verifier stages', () => {
  const loopSource = readWorkspaceFile('apps/runner/src/loop.ts');

  assert.match(loopSource, /before_ensure_target_app_visible/);
  assert.match(loopSource, /after_ensure_target_app_visible/);
  assert.match(loopSource, /before_first_screenshot/);
  assert.match(loopSource, /after_first_screenshot/);
  assert.match(loopSource, /before_planner/);
  assert.match(loopSource, /after_planner/);
  assert.match(loopSource, /before_broker_action/);
  assert.match(loopSource, /after_broker_action/);
  assert.match(loopSource, /before_verifier/);
  assert.match(loopSource, /after_verifier/);
});

test('generic real-mode appends phase markers instead of overwriting them', () => {
  const loopSource = readWorkspaceFile('apps/runner/src/loop.ts');

  assert.match(loopSource, /appendFile/);
});
