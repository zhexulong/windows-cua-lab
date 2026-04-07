import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceJson(relativePath: string): any {
  return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

test('transition schema declares all OpenAI-aligned action families we intend to support', () => {
  const schema = readWorkspaceJson('schemas/transition-envelope.json');
  const actions = schema.$defs.action.properties.kind.enum;

  assert.deepEqual(actions, [
    'screenshot',
    'click',
    'double_click',
    'type',
    'keypress',
    'scroll',
    'move',
    'drag',
    'wait'
  ]);
});
