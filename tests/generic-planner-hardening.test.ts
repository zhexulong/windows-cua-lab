import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

type PlannerFailureKind =
  | 'planner-timeout'
  | 'planner-http-failure'
  | 'planner-empty-response'
  | 'planner-shape-mismatch'
  | 'planner-invalid-json'
  | 'planner-action-rejected';

type PlannerFailure = Error & {
  kind: PlannerFailureKind;
  retryable: boolean;
};

type FetchStub = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type LoopPlannerExports = {
  callAiGenericPlanner?: (params: {
    task: string;
    targetApp: string;
    screenshot: Buffer;
    outputDir: string;
    aiBaseUrl?: string;
    aiKey?: string;
    requireLiveAi: boolean;
    plannerContext?: {
      second_pass_context?: {
        allowed_next_action_kinds?: string[];
        allowed_hotkeys?: string[];
      };
    };
  }) => Promise<{
    source: 'ai' | 'fallback';
    transport?: 'responses' | 'chat.completions';
    summary: string;
    action: { kind: string };
  }>;
};

async function loadPlannerExports(): Promise<LoopPlannerExports> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-planner-hardening-'));
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--outDir', outDir], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const loopModule = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  return loopModule as LoopPlannerExports;
}

function createPlannerFailure(value: unknown): PlannerFailure {
  assert.ok(value instanceof Error, 'expected planner call to reject with an Error');
  assert.equal(typeof (value as Partial<PlannerFailure>).kind, 'string');
  assert.equal(typeof (value as Partial<PlannerFailure>).retryable, 'boolean');
  return value as PlannerFailure;
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

function createPlannerParams(outputDir: string) {
  return {
    task: 'Advance the task safely.',
    targetApp: 'termius.exe',
    screenshot: Buffer.from('planner-screenshot'),
    outputDir,
    aiBaseUrl: 'http://127.0.0.1:4010',
    aiKey: 'test-key',
    requireLiveAi: true
  };
}

test('callAiGenericPlanner surfaces timeout as planner-timeout and retries three times', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.callAiGenericPlanner, 'function');
  if (!planner.callAiGenericPlanner) {
    return;
  }
  const callAiGenericPlanner = planner.callAiGenericPlanner;

  let plannerCalls = 0;

  await withStubbedRuntime({
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('responses available', { status: 200 });
      }

      plannerCalls += 1;
      const error = new Error('The operation timed out');
      error.name = 'AbortError';
      throw error;
    },
    run: async () => {
      await assert.rejects(
        callAiGenericPlanner(createPlannerParams(mkdtempSync(path.join(os.tmpdir(), 'planner-timeout-')))),
        (error) => {
          const failure = createPlannerFailure(error);
          assert.equal(failure.kind, 'planner-timeout');
          assert.equal(failure.retryable, true);
          assert.match(failure.message, /planner-timeout/);
          return true;
        }
      );
    }
  });

  assert.equal(plannerCalls, 3);
});

test('callAiGenericPlanner retries transport HTTP failures and succeeds on a later attempt', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.callAiGenericPlanner, 'function');
  if (!planner.callAiGenericPlanner) {
    return;
  }
  const callAiGenericPlanner = planner.callAiGenericPlanner;

  let plannerCalls = 0;

  const result = await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('responses available', { status: 200 });
      }

      plannerCalls += 1;
      if (plannerCalls < 3) {
        return new Response('bad gateway', { status: 502 });
      }

      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          summary: 'Click the visible host card.',
          action: {
            kind: 'click',
            position: { x: 100, y: 200 },
            target: 'visible host card'
          }
        })
      }), { status: 200 });
    },
    run: () => callAiGenericPlanner(createPlannerParams(mkdtempSync(path.join(os.tmpdir(), 'planner-http-'))))
  });

  assert.equal(plannerCalls, 3);
  assert.equal(result.source, 'ai');
  assert.equal(result.action.kind, 'click');
});

test('callAiGenericPlanner retries one empty completion and succeeds on the immediate retry', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.callAiGenericPlanner, 'function');
  if (!planner.callAiGenericPlanner) {
    return;
  }
  const callAiGenericPlanner = planner.callAiGenericPlanner;

  let plannerCalls = 0;

  await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('/v1/chat/completions only', { status: 200 });
      }

      plannerCalls += 1;
      if (plannerCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '' } }]
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          summary: 'Click the visible host card after empty retry.',
          action: {
            kind: 'click',
            position: { x: 120, y: 220 },
            target: 'visible host card'
          }
        }) } }]
      }), { status: 200 });
    },
    run: async () => {
      const result = await callAiGenericPlanner(createPlannerParams(mkdtempSync(path.join(os.tmpdir(), 'planner-empty-retry-success-'))));
      assert.equal(result.source, 'ai');
      assert.equal(result.action.kind, 'click');
      assert.equal(result.summary, 'Click the visible host card after empty retry.');
    }
  });

  assert.equal(plannerCalls, 2);
});

test('callAiGenericPlanner fails with explicit persisted-after-retry message when empty completion repeats', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.callAiGenericPlanner, 'function');
  if (!planner.callAiGenericPlanner) {
    return;
  }
  const callAiGenericPlanner = planner.callAiGenericPlanner;

  let plannerCalls = 0;

  await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('/v1/chat/completions only', { status: 200 });
      }

      plannerCalls += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '' } }]
      }), { status: 200 });
    },
    run: async () => {
      await assert.rejects(
        callAiGenericPlanner(createPlannerParams(mkdtempSync(path.join(os.tmpdir(), 'planner-empty-retry-failure-')))),
        (error) => {
          const failure = createPlannerFailure(error);
          assert.equal(failure.kind, 'planner-empty-response');
          assert.equal(failure.retryable, false);
          assert.match(failure.message, /persisted after retry/i);
          return true;
        }
      );
    }
  });

  assert.equal(plannerCalls, 2);
});

test('callAiGenericPlanner surfaces response shape mismatches as planner-shape-mismatch without retrying', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.callAiGenericPlanner, 'function');
  if (!planner.callAiGenericPlanner) {
    return;
  }
  const callAiGenericPlanner = planner.callAiGenericPlanner;

  let plannerCalls = 0;

  await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('responses available', { status: 200 });
      }

      plannerCalls += 1;
      return new Response(JSON.stringify({
        output: [{ content: [{ type: 'image' }] }]
      }), { status: 200 });
    },
    run: async () => {
      await assert.rejects(
        callAiGenericPlanner(createPlannerParams(mkdtempSync(path.join(os.tmpdir(), 'planner-shape-')))),
        (error) => {
          const failure = createPlannerFailure(error);
          assert.equal(failure.kind, 'planner-shape-mismatch');
          assert.equal(failure.retryable, false);
          return true;
        }
      );
    }
  });

  assert.equal(plannerCalls, 1);
});

test('callAiGenericPlanner surfaces malformed planner JSON as planner-invalid-json without retrying', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.callAiGenericPlanner, 'function');
  if (!planner.callAiGenericPlanner) {
    return;
  }
  const callAiGenericPlanner = planner.callAiGenericPlanner;

  let plannerCalls = 0;

  await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('responses available', { status: 200 });
      }

      plannerCalls += 1;
      return new Response(JSON.stringify({
        output_text: '{"summary":"broken json"'
      }), { status: 200 });
    },
    run: async () => {
      await assert.rejects(
        callAiGenericPlanner(createPlannerParams(mkdtempSync(path.join(os.tmpdir(), 'planner-invalid-json-')))),
        (error) => {
          const failure = createPlannerFailure(error);
          assert.equal(failure.kind, 'planner-invalid-json');
          assert.equal(failure.retryable, false);
          return true;
        }
      );
    }
  });

  assert.equal(plannerCalls, 1);
});

test('callAiGenericPlanner keeps action validation rejection distinct as planner-action-rejected without retrying', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.callAiGenericPlanner, 'function');
  if (!planner.callAiGenericPlanner) {
    return;
  }
  const callAiGenericPlanner = planner.callAiGenericPlanner;

  let plannerCalls = 0;

  await withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('responses available', { status: 200 });
      }

      plannerCalls += 1;
      return new Response(JSON.stringify({
        output_text: JSON.stringify({
          summary: 'Click the global app surface.',
          action: {
            kind: 'click',
            position: { x: 40, y: 40 },
            target: 'target-app'
          }
        })
      }), { status: 200 });
    },
    run: async () => {
      await assert.rejects(
        callAiGenericPlanner({
          ...createPlannerParams(mkdtempSync(path.join(os.tmpdir(), 'planner-action-rejected-'))),
          plannerContext: {
            second_pass_context: {
              allowed_next_action_kinds: ['hotkey'],
              allowed_hotkeys: ['ENTER']
            }
          }
        }),
        (error) => {
          const failure = createPlannerFailure(error);
          assert.equal(failure.kind, 'planner-action-rejected');
          assert.equal(failure.retryable, false);
          assert.match(failure.message, /rejected/i);
          assert.doesNotMatch(failure.message, /http|timeout|service/i);
          return true;
        }
      );
    }
  });

  assert.equal(plannerCalls, 1);
});
