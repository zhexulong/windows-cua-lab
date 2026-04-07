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
  extractComputerCallFromPayload?: (payload: unknown) =>
    | { ok: true; callId: string; action: unknown }
    | { ok: false; failureKind: 'empty_completion' | 'shape_mismatch'; message: string };
  chooseRetryTransport?: (input: {
    currentTransport: 'responses' | 'chat.completions';
    failureKind: 'empty_completion' | 'shape_mismatch' | 'service_error' | 'http_error' | 'timeout' | 'invalid_json';
  }) => 'responses' | 'chat.completions';
  buildGenericPlannerRequestBody?: (input: {
    transport: 'responses' | 'chat.completions';
    plannerInstruction: string;
    imageUrl: string;
  }) => unknown;
  extractStreamedOutputText?: (input: {
    transport: 'responses' | 'chat.completions';
    rawText: string;
  }) =>
    | { ok: true; text: string }
    | { ok: false; failureKind: 'empty_completion' | 'shape_mismatch' | 'invalid_json'; message: string };
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

test('classifies null chat completion content as empty_completion', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.classifyAiResponseFailure, 'function');
  if (!hardening.classifyAiResponseFailure) {
    return;
  }

  const result = hardening.classifyAiResponseFailure({
    transport: 'chat.completions',
    rawText: JSON.stringify({
      choices: [{ message: { content: null } }]
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

test('extracts computer_call actions from responses payloads without treating them as plain text', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.extractComputerCallFromPayload, 'function');
  if (!hardening.extractComputerCallFromPayload) {
    return;
  }

  const result = hardening.extractComputerCallFromPayload({
    output: [
      {
        type: 'computer_call',
        call_id: 'call_123',
        action: {
          type: 'keypress',
          keys: ['CTRL', 'C']
        }
      }
    ]
  });

  assert.deepEqual(result, {
    ok: true,
    callId: 'call_123',
    action: {
      type: 'keypress',
      keys: ['CTRL', 'C']
    }
  });
});

test('classifies malformed computer_call payloads as shape_mismatch', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.extractComputerCallFromPayload, 'function');
  if (!hardening.extractComputerCallFromPayload) {
    return;
  }

  const result = hardening.extractComputerCallFromPayload({
    output: [
      {
        type: 'computer_call',
        call_id: 'call_123'
      }
    ]
  });

  assert.deepEqual(result, {
    ok: false,
    failureKind: 'shape_mismatch',
    message: 'AI payload computer_call item did not include a valid action object.'
  });
});

test('switches planner retry transport from chat.completions to responses after empty completion', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.chooseRetryTransport, 'function');
  if (!hardening.chooseRetryTransport) {
    return;
  }

  const nextTransport = hardening.chooseRetryTransport({
    currentTransport: 'chat.completions',
    failureKind: 'empty_completion'
  });

  assert.equal(nextTransport, 'responses');
});

test('builds responses planner payloads using message-shaped input items', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.buildGenericPlannerRequestBody, 'function');
  if (!hardening.buildGenericPlannerRequestBody) {
    return;
  }

  const body = hardening.buildGenericPlannerRequestBody({
    transport: 'responses',
    plannerInstruction: 'Return JSON only.',
    imageUrl: 'data:image/png;base64,ZmFrZQ=='
  }) as { input?: unknown[]; reasoning_effort?: string };

  assert.equal(body.reasoning_effort, 'none');
  assert.ok(Array.isArray(body.input));
  assert.deepEqual(body.input, [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: 'Return JSON only.' },
        { type: 'input_image', image_url: 'data:image/png;base64,ZmFrZQ==' }
      ]
    }
  ]);
});

test('extracts streamed chat completion delta text', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.extractStreamedOutputText, 'function');
  if (!hardening.extractStreamedOutputText) {
    return;
  }

  const result = hardening.extractStreamedOutputText({
    transport: 'chat.completions',
    rawText: [
      'data: {"choices":[{"delta":{"content":"OK"}}]}',
      '',
      'data: [DONE]',
      ''
    ].join('\n')
  });

  assert.deepEqual(result, {
    ok: true,
    text: 'OK'
  });
});

test('extracts streamed chat completion reasoning_content text when content is absent', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.extractStreamedOutputText, 'function');
  if (!hardening.extractStreamedOutputText) {
    return;
  }

  const result = hardening.extractStreamedOutputText({
    transport: 'chat.completions',
    rawText: [
      'data: {"choices":[{"delta":{"reasoning_content":"OK"}}]}',
      '',
      'data: [DONE]',
      ''
    ].join('\n')
  });

  assert.deepEqual(result, {
    ok: true,
    text: 'OK'
  });
});

test('extracts streamed responses output_text delta text', async () => {
  const hardening = await loadHardeningExports();
  assert.equal(typeof hardening.extractStreamedOutputText, 'function');
  if (!hardening.extractStreamedOutputText) {
    return;
  }

  const result = hardening.extractStreamedOutputText({
    transport: 'responses',
    rawText: [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"OK"}',
      '',
      'event: response.output_text.done',
      'data: {"type":"response.output_text.done","text":"OK"}',
      ''
    ].join('\n')
  });

  assert.deepEqual(result, {
    ok: true,
    text: 'OK'
  });
});
