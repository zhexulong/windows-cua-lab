import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { canvasToPngBuffer, cloneCanvas, createPaintCanvas } from '../apps/runner/src/traces.ts';

type FetchStub = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type GenericSemanticClassification = {
  semanticState: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
  summary: string;
  classificationKind:
    | 'semantic_success_like'
    | 'semantic_failure_like'
    | 'semantic_loading'
    | 'semantic_ambiguous'
    | 'verifier_empty_response'
    | 'verifier_parse_failure'
    | 'verifier_timeout'
    | 'verifier_shape_mismatch';
};

type LoopSettleExports = {
  parseGenericSettleClassificationJson?: (outputText: string) => GenericSemanticClassification;
  classifyGenericScreenshotPair?: (params: {
    beforeScreenshot: Buffer;
    candidateScreenshot: Buffer;
    offsetMs: number;
    action: { kind: string; target?: string };
    task: string;
    targetApp: string;
    outputDir: string;
    aiBaseUrl?: string;
    aiKey?: string;
  }) => Promise<GenericSemanticClassification>;
  settleAndVerifyGenericAction?: (params: {
    beforeScreenshot: Buffer;
    captureScreenshotAtOffset: (offsetMs: number) => Promise<{ buffer: Buffer; screenshotRef: string }>;
    classifyScreenshotPair: (input: { before: Buffer; candidate: Buffer; offsetMs: number }) => Promise<GenericSemanticClassification>;
    action: { kind: string; target?: string };
    beforeRef: string;
  }) => Promise<{
    verification: {
      status: 'passed' | 'failed' | 'unknown';
      summary?: string;
      semanticState?: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
    };
    traceEntries: Array<{
      offsetMs?: number;
      aiInvoked?: boolean;
      semanticState?: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
      summary?: string;
    }>;
  }>;
};

const require = createRequire(import.meta.url);

async function loadSettleExports(): Promise<LoopSettleExports> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-settle-hardening-'));
  const tscEntrypoint = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tscEntrypoint, '-p', 'tsconfig.json', '--outDir', outDir], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const loopModule = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  return loopModule as LoopSettleExports;
}

async function withStubbedRuntime<T>(options: {
  fetchImpl: FetchStub;
  run: () => Promise<T>;
}): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.fetch = options.fetchImpl as typeof fetch;
  globalThis.setTimeout = (((callback: TimerHandler, _delay?: number, ...args: unknown[]) => {
    if (typeof callback === 'function') {
      callback(...args);
    }
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as unknown) as typeof setTimeout;

  try {
    return await options.run();
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}

function createVerifierParams(outputDir: string) {
  return {
    beforeScreenshot: Buffer.from('before-screenshot'),
    candidateScreenshot: Buffer.from('candidate-screenshot'),
    offsetMs: 0,
    action: { kind: 'click', target: 'host-card' },
    task: 'Open the selected host session.',
    targetApp: 'termius.exe',
    outputDir,
    aiBaseUrl: 'http://127.0.0.1:4010',
    aiKey: 'test-key'
  };
}

function createChatCompletionStream(chunks: string[]): string {
  return [
    ...chunks.map((chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}`),
    'data: [DONE]',
    ''
  ].join('\n');
}
test('parseGenericSettleClassificationJson classifies invalid JSON as verifier_parse_failure', async () => {
  const settle = await loadSettleExports();
  assert.equal(typeof settle.parseGenericSettleClassificationJson, 'function');
  if (!settle.parseGenericSettleClassificationJson) {
    return;
  }

  const result = settle.parseGenericSettleClassificationJson('{"semanticState":');

  assert.equal(result.semanticState, 'ambiguous');
  assert.equal(result.classificationKind, 'verifier_parse_failure');
  assert.match(result.summary, /verifier parse failure/i);
});

test('parseGenericSettleClassificationJson classifies unsupported semanticState as verifier_shape_mismatch', async () => {
  const settle = await loadSettleExports();
  assert.equal(typeof settle.parseGenericSettleClassificationJson, 'function');
  if (!settle.parseGenericSettleClassificationJson) {
    return;
  }

  const result = settle.parseGenericSettleClassificationJson(JSON.stringify({
    semanticState: 'maybe_success',
    summary: 'The output used an unsupported value.'
  }));

  assert.equal(result.semanticState, 'ambiguous');
  assert.equal(result.classificationKind, 'verifier_shape_mismatch');
  assert.match(result.summary, /unsupported semanticstate/i);
});

test('parseGenericSettleClassificationJson preserves true semantic ambiguity distinctly', async () => {
  const settle = await loadSettleExports();
  assert.equal(typeof settle.parseGenericSettleClassificationJson, 'function');
  if (!settle.parseGenericSettleClassificationJson) {
    return;
  }

  const result = settle.parseGenericSettleClassificationJson(JSON.stringify({
    semanticState: 'ambiguous',
    summary: 'The candidate changed, but the destination state is still genuinely unclear.'
  }));

  assert.equal(result.semanticState, 'ambiguous');
  assert.equal(result.classificationKind, 'semantic_ambiguous');
  assert.match(result.summary, /genuinely unclear/i);
});

test('classifyGenericScreenshotPair retries one immediate time when the first settle verifier completion is empty', async () => {
  const settle = await loadSettleExports();
  assert.equal(typeof settle.classifyGenericScreenshotPair, 'function');
  if (!settle.classifyGenericScreenshotPair) {
    return;
  }

  let classifierCalls = 0;

  const result = await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('/v1/chat/completions only', { status: 200 });
      }

      classifierCalls += 1;

      if (classifierCalls === 1) {
        return new Response(createChatCompletionStream([]), { status: 200 });
      }

      return new Response(createChatCompletionStream([
        JSON.stringify({ semanticState: 'success_like', summary: 'Terminal session content is visible.' })
      ]), { status: 200 });
    },
    run: () => settle.classifyGenericScreenshotPair!(createVerifierParams(mkdtempSync(path.join(os.tmpdir(), 'settle-empty-'))))
  });

  assert.equal(classifierCalls, 2);
  assert.equal(result.semanticState, 'success_like');
  assert.equal(result.classificationKind, 'semantic_success_like');
  assert.match(result.summary, /terminal session content is visible/i);
});

test('classifyGenericScreenshotPair degrades empty completion bodies after one immediate retry and preserves verifier provenance', async () => {
  const settle = await loadSettleExports();
  assert.equal(typeof settle.classifyGenericScreenshotPair, 'function');
  if (!settle.classifyGenericScreenshotPair) {
    return;
  }

  let classifierCalls = 0;

  const result = await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('/v1/chat/completions only', { status: 200 });
      }

      classifierCalls += 1;

      return new Response(createChatCompletionStream([]), { status: 200 });
    },
    run: () => settle.classifyGenericScreenshotPair!(createVerifierParams(mkdtempSync(path.join(os.tmpdir(), 'settle-empty-repeat-'))))
  });

  assert.equal(classifierCalls, 2);

  assert.equal(result.semanticState, 'ambiguous');
  assert.equal(result.classificationKind, 'verifier_empty_response');
  assert.match(result.summary, /empty response/i);
  assert.match(result.summary, /after 1 retry/i);
});

test('classifyGenericScreenshotPair downgrades timeouts to verifier_timeout', async () => {
  const settle = await loadSettleExports();
  assert.equal(typeof settle.classifyGenericScreenshotPair, 'function');
  if (!settle.classifyGenericScreenshotPair) {
    return;
  }

  const result = await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('responses available', { status: 200 });
      }

      const error = new Error('The operation timed out');
      error.name = 'AbortError';
      throw error;
    },
    run: () => settle.classifyGenericScreenshotPair!(createVerifierParams(mkdtempSync(path.join(os.tmpdir(), 'settle-timeout-'))))
  });

  assert.equal(result.semanticState, 'ambiguous');
  assert.equal(result.classificationKind, 'verifier_timeout');
  assert.match(result.summary, /timeout/i);
});

test('settleAndVerifyGenericAction names degraded verifier reuse distinctly from true semantic ambiguity', async () => {
  const settle = await loadSettleExports();
  assert.equal(typeof settle.settleAndVerifyGenericAction, 'function');
  if (!settle.settleAndVerifyGenericAction) {
    return;
  }

  const beforeScreenshot = Buffer.from('before');
  const beforeCanvas = createPaintCanvas(48, 32);
  const after0Canvas = cloneCanvas(beforeCanvas);
  const result = await settle.settleAndVerifyGenericAction({
    beforeScreenshot: canvasToPngBuffer(beforeCanvas),
    beforeRef: 'screenshots/before.png',
    action: { kind: 'click', target: 'host-card' },
    captureScreenshotAtOffset: async (offsetMs: number) => ({
      buffer: canvasToPngBuffer(after0Canvas),
      screenshotRef: `screenshots/after-${offsetMs}.png`
    }),
    classifyScreenshotPair: async ({ offsetMs }: { before: Buffer; candidate: Buffer; offsetMs: number }) => {
      assert.equal(offsetMs, 0);
      return {
        semanticState: 'ambiguous',
        classificationKind: 'verifier_parse_failure',
        summary: 'Settle verifier parse failure: extracted text could not be decoded as JSON.'
      };
    }
  });

  assert.equal(result.verification.semanticState, 'ambiguous');
  assert.match(result.verification.summary ?? '', /verifier parse failure/i);

  const reusedEntry = result.traceEntries.find((entry) => entry.offsetMs === 250);
  assert.ok(reusedEntry);
  assert.equal(reusedEntry?.aiInvoked, false);
  assert.match(reusedEntry?.summary ?? '', /verifier_parse_failure/i);
  assert.doesNotMatch(reusedEntry?.summary ?? '', /reusing semantic state ambiguous\.?$/i);
});
