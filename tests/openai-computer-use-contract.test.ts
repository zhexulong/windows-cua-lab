import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

type OpenAiComputerUseContractExports = {
  buildComputerCallOutput?: (input: {
    callId: string;
    pngBase64: string;
    status?: 'completed' | 'failed';
  }) => unknown;
  parseOpenAiComputerAction?: (input: unknown) => {
    kind: string;
    keys?: string[];
    position?: { x: number; y: number };
    delta_x?: number;
    delta_y?: number;
  };
};

async function loadContractExports(): Promise<OpenAiComputerUseContractExports> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-openai-contract-'));
  const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json', '--outDir', outDir], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const contractModule = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/openai-computer-use-contract.js')).href);
  return contractModule as OpenAiComputerUseContractExports;
}

test('serializes screenshot feedback as a computer_call_output image payload', async () => {
  const contract = await loadContractExports();
  assert.equal(typeof contract.buildComputerCallOutput, 'function');
  if (!contract.buildComputerCallOutput) {
    return;
  }

  const output = contract.buildComputerCallOutput({
    callId: 'call_123',
    pngBase64: 'ZmFrZQ=='
  });

  assert.deepEqual(output, {
    type: 'computer_call_output',
    call_id: 'call_123',
    status: 'completed',
    output: {
      type: 'computer_screenshot',
      image_url: 'data:image/png;base64,ZmFrZQ=='
    }
  });
});

test('maps official keypress actions onto bounded runtime keyboard execution', async () => {
  const contract = await loadContractExports();
  assert.equal(typeof contract.parseOpenAiComputerAction, 'function');
  if (!contract.parseOpenAiComputerAction) {
    return;
  }

  const action = contract.parseOpenAiComputerAction({
    type: 'keypress',
    keys: ['CTRL', 'C']
  });

  assert.equal(action.kind, 'keypress');
  assert.deepEqual(action.keys, ['CTRL', 'C']);
});

test('maps official scroll actions onto bounded runtime scroll execution', async () => {
  const contract = await loadContractExports();
  assert.equal(typeof contract.parseOpenAiComputerAction, 'function');
  if (!contract.parseOpenAiComputerAction) {
    return;
  }

  const action = contract.parseOpenAiComputerAction({
    type: 'scroll',
    x: 400,
    y: 300,
    delta_x: 0,
    delta_y: -240,
  });

  assert.equal(action.kind, 'scroll');
  assert.deepEqual(action.position, { x: 400, y: 300 });
  assert.equal(action.delta_x, 0);
  assert.equal(action.delta_y, -240);
});

test('maps official horizontal-only scroll actions by defaulting delta_y to zero', async () => {
  const contract = await loadContractExports();
  assert.equal(typeof contract.parseOpenAiComputerAction, 'function');
  if (!contract.parseOpenAiComputerAction) {
    return;
  }

  const action = contract.parseOpenAiComputerAction({
    type: 'scroll',
    x: 640,
    y: 120,
    delta_x: 180,
  });

  assert.equal(action.kind, 'scroll');
  assert.deepEqual(action.position, { x: 640, y: 120 });
  assert.equal(action.delta_x, 180);
  assert.equal(action.delta_y, 0);
});
