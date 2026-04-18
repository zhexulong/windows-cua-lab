import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
        preferred_target_continuity?: boolean;
        previous_target_ref?: string;
        reject_unrelated_global_actions?: boolean;
        tool_inventory?: string[];
      };
    };
  }) => Promise<{
    source: 'ai' | 'fallback';
    transport?: 'responses' | 'chat.completions';
      summary: string;
      action: { kind: string };
    }>;
  runGenericDemo?: (options: {
    mode: 'mock' | 'real';
    outputDir: string;
    task: string;
    targetApp: string;
    aiBaseUrl?: string;
    aiKey?: string;
    startBrokerIfNeeded: boolean;
    brokerEndpoint?: string;
    brokerApiKey?: string;
    reportPath?: string;
    plannerContext?: {
      second_pass_context?: {
        preferred_target_continuity?: boolean;
        previous_target_ref?: string;
        reject_unrelated_global_actions?: boolean;
        tool_inventory?: string[];
      };
    };
  }) => Promise<{ outputDir: string }>;
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

async function withDebugHarnessEnabled<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.FULL_APP_VERIFICATION_DEBUG;
  process.env.FULL_APP_VERIFICATION_DEBUG = '1';
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.FULL_APP_VERIFICATION_DEBUG;
    } else {
      process.env.FULL_APP_VERIFICATION_DEBUG = previous;
    }
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

function createResponsesStream(text: string) {
  return `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n`
}

function createChatCompletionsStream(text: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\ndata: [DONE]\n`
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

      return new Response(
        createResponsesStream(JSON.stringify({
          summary: 'Click the visible host card.',
          action: {
            kind: 'click',
            position: { x: 100, y: 200 },
            target: 'visible host card'
          }
        })),
        { status: 200 }
      );
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
        return new Response('data: {"choices":[{"delta":{}}]}\ndata: [DONE]\n', { status: 200 });
      }

      return new Response(createResponsesStream(JSON.stringify({
          summary: 'Click the visible host card after empty retry.',
          action: {
            kind: 'click',
            position: { x: 120, y: 220 },
            target: 'visible host card'
          }
        })), { status: 200 });
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
      return new Response('data: {"type":"response.completed"}\n', { status: 200 });
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
      return new Response(
        createResponsesStream(JSON.stringify({
          summary: 'Planner returned an unsupported action payload.',
          action: {
            kind: 'screenshot',
            target: 'visible host card'
          }
        })),
        { status: 200 }
      );
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
      return new Response(createResponsesStream('{"summary":"broken json"'), { status: 200 });
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

test('callAiGenericPlanner allows a bounded keypress when tool_inventory includes it and continuity still holds', async () => {
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
      return new Response(
        createResponsesStream(JSON.stringify({
          summary: 'Press Enter on the selected host card.',
          action: {
            kind: 'keypress',
            keys: ['ENTER'],
            target: "Host card 'wsl2204'"
          }
        })),
        { status: 200 }
      );
    },
    run: async () => {
      const result = await callAiGenericPlanner({
        ...createPlannerParams(mkdtempSync(path.join(os.tmpdir(), 'planner-tool-inventory-'))),
        plannerContext: {
          second_pass_context: {
            preferred_target_continuity: true,
            previous_target_ref: "Host card 'wsl2204'",
            reject_unrelated_global_actions: true,
            tool_inventory: ['click', 'double_click', 'keypress', 'type']
          }
        }
      });

      assert.equal(result.source, 'ai');
      assert.equal(result.action.kind, 'keypress');
    }
  });

  assert.equal(plannerCalls, 1);
});

test('callAiGenericPlanner writes planner-attempts and planner-error artifacts in debug mode when retries end in timeout', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.callAiGenericPlanner, 'function');
  if (!planner.callAiGenericPlanner) {
    return;
  }
  const callAiGenericPlanner = planner.callAiGenericPlanner;
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'planner-debug-artifacts-'));

  await withDebugHarnessEnabled(() => withStubbedRuntime({
    fetchImpl: async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('responses available', { status: 200 });
      }

      const error = new Error('The operation timed out');
      error.name = 'AbortError';
      throw error;
    },
    run: async () => {
      await assert.rejects(
        callAiGenericPlanner(createPlannerParams(outputDir)),
        (error) => createPlannerFailure(error).kind === 'planner-timeout'
      );
    }
  }));

  const attempts = JSON.parse(await readFile(path.join(outputDir, 'planner-attempts.json'), 'utf8'));
  const plannerError = JSON.parse(await readFile(path.join(outputDir, 'planner-error.json'), 'utf8'));

  assert.equal(Array.isArray(attempts.attempts), true);
  assert.equal(attempts.attempts.length, 3);
  assert.equal(plannerError.kind, 'planner-timeout');
});

test('runGenericDemo writes action-decision.json in debug mode so the final executed action is explicit', async () => {
  const planner = await loadPlannerExports();
  assert.equal(typeof planner.runGenericDemo, 'function');
  if (!planner.runGenericDemo) {
    return;
  }

  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'generic-action-decision-'));

  await withDebugHarnessEnabled(() => withStubbedRuntime({
    fetchImpl: async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:4010/') {
        return new Response('responses available', { status: 200 });
      }

      return new Response(
        createResponsesStream(JSON.stringify({
          summary: 'Press Enter on the selected host card.',
          action: {
            kind: 'keypress',
            keys: ['ENTER'],
            target: "Host card 'wsl2204'"
          }
        })),
        { status: 200 }
      );
    },
    run: async () => {
      await planner.runGenericDemo!({
        mode: 'mock',
        outputDir,
        task: 'Confirm session entry in Termius.',
        targetApp: 'termius.exe',
        aiBaseUrl: 'http://127.0.0.1:4010',
        aiKey: 'test-key',
        startBrokerIfNeeded: false,
        plannerContext: {
          second_pass_context: {
            preferred_target_continuity: true,
            previous_target_ref: "Host card 'wsl2204'",
            reject_unrelated_global_actions: true,
            tool_inventory: ['click', 'double_click', 'keypress', 'type']
          }
        }
      });
    }
  }));

  const actionDecision = JSON.parse(await readFile(path.join(outputDir, 'action-decision.json'), 'utf8'));
  assert.equal(actionDecision.planner_source, 'ai');
  assert.equal(actionDecision.planner_action.kind, 'keypress');
  assert.equal(actionDecision.executed_action.kind, 'keypress');
});
