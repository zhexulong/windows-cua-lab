import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function compileRunnerToTemp() {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-parser-test-'));
  const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json', '--outDir', outDir], {
    cwd: repoRoot,
    stdio: 'pipe'
  });
  return { outDir };
}

test('parsePlannerAction accepts double_click with button and position', async () => {
  const { outDir } = compileRunnerToTemp();
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

test('parsePlannerAction accepts click with top-level x and y', async () => {
  const { outDir } = compileRunnerToTemp();
  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'click',
    button: 'left',
    x: 1440,
    y: 512,
    target: 'Visible host row'
  }, 'termius.exe');

  assert.equal(action.kind, 'click');
  assert.equal(action.button, 'left');
  assert.deepEqual(action.position, { x: 1440, y: 512 });
  assert.equal(action.target, 'Visible host row');
});

test('parsePlannerAction accepts double_click with top-level x and y', async () => {
  const { outDir } = compileRunnerToTemp();
  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'double_click',
    button: 'left',
    x: 1440,
    y: 512,
    target: 'Visible host row'
  }, 'termius.exe');

  assert.equal(action.kind, 'double_click');
  assert.equal(action.button, 'left');
  assert.deepEqual(action.position, { x: 1440, y: 512 });
  assert.equal(action.target, 'Visible host row');
});

test('parsePlannerAction falls back to current cursor position for click without coordinates', async () => {
  const { outDir } = compileRunnerToTemp();
  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'click',
    button: 'left',
    target: 'Visible host row'
  }, 'termius.exe', () => ({ x: 900, y: 420 }));

  assert.equal(action.kind, 'click');
  assert.equal(action.button, 'left');
  assert.deepEqual(action.position, { x: 900, y: 420 });
  assert.equal(action.target, 'Visible host row');
});

test('parsePlannerAction falls back to current cursor position for double_click without coordinates', async () => {
  const { outDir } = compileRunnerToTemp();
  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'double_click',
    button: 'left',
    target: 'Visible host row'
  }, 'termius.exe', () => ({ x: 901, y: 421 }));

  assert.equal(action.kind, 'double_click');
  assert.equal(action.button, 'left');
  assert.deepEqual(action.position, { x: 901, y: 421 });
  assert.equal(action.target, 'Visible host row');
});

test('parsePlannerAction accepts move with top-level x and y', async () => {
  const { outDir } = compileRunnerToTemp();
  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'move',
    x: 1024,
    y: 768,
    target: 'Hovered host row'
  }, 'termius.exe');

  assert.equal(action.kind, 'move');
  assert.deepEqual(action.position, { x: 1024, y: 768 });
  assert.equal(action.target, 'Hovered host row');
});

test('parsePlannerAction accepts scroll with top-level x and y', async () => {
  const { outDir } = compileRunnerToTemp();
  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'scroll',
    x: 960,
    y: 540,
    delta_y: -480,
    target: 'Hosts list'
  }, 'termius.exe');

  assert.equal(action.kind, 'scroll');
  assert.deepEqual(action.position, { x: 960, y: 540 });
  assert.equal(action.delta_x, 0);
  assert.equal(action.delta_y, -480);
  assert.equal(action.target, 'Hosts list');
});

test('parsePlannerAction accepts scroll with only delta_y and defaults delta_x to zero', async () => {
  const { outDir } = compileRunnerToTemp();
  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'scroll',
    target: 'Hosts list',
    delta_y: -480,
  }, 'termius.exe');

  assert.equal(action.kind, 'scroll');
  assert.equal(action.delta_x, 0);
  assert.equal(action.delta_y, -480);
  assert.equal(action.target, 'Hosts list');
});

test('parsePlannerAction accepts scroll with only delta_x and defaults delta_y to zero', async () => {
  const { outDir } = compileRunnerToTemp();
  const { parsePlannerAction } = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  const action = parsePlannerAction({
    kind: 'scroll',
    target: 'Horizontal tab strip',
    delta_x: 240,
  }, 'termius.exe');

  assert.equal(action.kind, 'scroll');
  assert.equal(action.delta_x, 240);
  assert.equal(action.delta_y, 0);
  assert.equal(action.target, 'Horizontal tab strip');
});
