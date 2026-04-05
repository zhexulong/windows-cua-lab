import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

type LoopHardeningExports = {
  classifyAiHttpFailure?: (input: { status: number; rawText: string }) => {
    ok: false;
    failureKind: 'http_error' | 'service_error';
    message: string;
    rawText: string;
    status?: number;
  };
  classifyAiResponseFailure?: (input: {
    transport: 'responses' | 'chat.completions';
    rawText: string;
  }) => {
    ok: false;
    transport: 'responses' | 'chat.completions';
    failureKind: 'service_error' | 'empty_completion' | 'shape_mismatch' | 'invalid_json';
    message: string;
    rawText: string;
    payload?: unknown;
  };
  classifyAiThrownError?: (error: unknown) => {
    ok: false;
    failureKind: 'timeout';
    message: string;
  } | undefined;
  extractOutputTextFromPayload?: (payload: unknown) =>
    | { ok: true; text: string }
    | { ok: false; failureKind: 'empty_completion' | 'shape_mismatch'; message: string };
};

async function loadHardeningExports(): Promise<LoopHardeningExports> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-hardening-test-'));
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--outDir', outDir], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const loopModule = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  return loopModule as LoopHardeningExports;
}

test('classifies timeout errors as timeout failures', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.classifyAiThrownError, 'function');
  if (!hardening.classifyAiThrownError) {
    return;
  }

  const error = new Error('The operation was aborted due to timeout');
  error.name = 'AbortError';

  const result = hardening.classifyAiThrownError(error);

  assert.deepEqual(result, {
    ok: false,
    failureKind: 'timeout',
    message: 'The AI request timed out.'
  });
});

test('classifies non-OK HTTP responses as http_error failures', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.classifyAiHttpFailure, 'function');
  if (!hardening.classifyAiHttpFailure) {
    return;
  }

  const result = hardening.classifyAiHttpFailure({
    status: 502,
    rawText: 'bad gateway'
  });

  assert.equal(result.failureKind, 'http_error');
  assert.equal(result.status, 502);
  assert.match(result.message, /502/);
});

test('classifies service error payloads as service_error', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.classifyAiResponseFailure, 'function');
  if (!hardening.classifyAiResponseFailure) {
    return;
  }

  const result = hardening.classifyAiResponseFailure({
    transport: 'responses',
    rawText: JSON.stringify({
      error: {
        message: 'upstream unavailable'
      }
    })
  });

  assert.equal(result.failureKind, 'service_error');
  assert.match(result.message, /upstream unavailable/);
});

test('classifies empty chat completion content as empty_completion', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.classifyAiResponseFailure, 'function');
  if (!hardening.classifyAiResponseFailure) {
    return;
  }

  const result = hardening.classifyAiResponseFailure({
    transport: 'chat.completions',
    rawText: JSON.stringify({
      choices: [{ message: { content: '' } }]
    })
  });

  assert.equal(result.failureKind, 'empty_completion');
});

test('classifies missing output text shape as shape_mismatch', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.classifyAiResponseFailure, 'function');
  if (!hardening.classifyAiResponseFailure) {
    return;
  }

  const result = hardening.classifyAiResponseFailure({
    transport: 'responses',
    rawText: JSON.stringify({
      output: [{ content: [{ type: 'image' }] }]
    })
  });

  assert.equal(result.failureKind, 'shape_mismatch');
});

test('classifies invalid top-level JSON as invalid_json', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.classifyAiResponseFailure, 'function');
  if (!hardening.classifyAiResponseFailure) {
    return;
  }

  const result = hardening.classifyAiResponseFailure({
    transport: 'responses',
    rawText: '{"output_text":'
  });

  assert.equal(result.failureKind, 'invalid_json');
});

test('extracts text from supported response shapes', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.extractOutputTextFromPayload, 'function');
  if (!hardening.extractOutputTextFromPayload) {
    return;
  }

  const result = hardening.extractOutputTextFromPayload({
    output_text: 'hello'
  });

  assert.deepEqual(result, {
    ok: true,
    text: 'hello'
  });
});
