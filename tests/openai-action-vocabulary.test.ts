import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceJson(relativePath: string): any {
  return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8'));
}

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('transition schema includes keypress in the aligned action vocabulary', () => {
  const schema = readWorkspaceJson('schemas/transition-envelope.json');

  assert.match(JSON.stringify(schema.$defs.action.properties.kind.enum), /keypress/);
});

test('transition schema includes move, scroll, and wait in the aligned action vocabulary', () => {
  const schema = readWorkspaceJson('schemas/transition-envelope.json');
  const serialized = JSON.stringify(schema.$defs.action.properties.kind.enum);

  assert.match(serialized, /move/);
  assert.match(serialized, /scroll/);
  assert.match(serialized, /wait/);
});

test('planner parser supports keypress, move, scroll, and wait action kinds', () => {
  const loopSource = readWorkspaceFile('apps/runner/src/loop.ts');

  assert.match(loopSource, /case 'keypress':/);
  assert.match(loopSource, /case 'move':/);
  assert.match(loopSource, /case 'scroll':/);
  assert.match(loopSource, /case 'wait':/);
});

test('generic real-mode handles wait without routing it to the broker', () => {
  const loopSource = readWorkspaceFile('apps/runner/src/loop.ts');

  assert.match(loopSource, /plannerDecision\.action\.kind\s*===\s*'wait'/);
});
