import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('parsePlannerAction accepts double_click with button and position', async () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-parser-test-'));
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--outDir', outDir], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'double_click',
    button: 'left',
    position: { x: 320, y: 180 },
    target: 'Host card alias'
  }, 'termius.exe');

  assert.equal(action.kind, 'double_click');
  assert.equal(action.button, 'left');
  assert.deepEqual(action.position, { x: 320, y: 180 });
  assert.equal(action.target, 'Host card alias');
});
