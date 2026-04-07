import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

type ReplayExports = {
  buildTransition?: (input: {
    action: unknown;
    beforeRef: string;
    afterRef: string;
    verification: unknown;
    safetyEvent: { decision: string; reason?: string; policyRefs?: string[] };
    provenance: string;
    targetApp: string;
    notes?: string[];
    computerUse?: { callId?: string; responseId?: string; previousResponseId?: string };
  }) => unknown;
  buildReplayTrace?: (input: {
    traceId: string;
    sessionId: string;
    targetApp: string;
    screenshots: string[];
    summaryReport: string;
    transition: unknown;
    verificationPassed: boolean;
    notes: string[];
    computerUse?: { responseId?: string; previousResponseId?: string; outputRef?: string };
  }) => unknown;
};

async function loadReplayExports(): Promise<ReplayExports> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-replay-fidelity-'));
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json', '--outDir', outDir], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const loopModule = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  return loopModule as ReplayExports;
}

test('buildTransition and buildReplayTrace preserve policy refs and computer-use linkage', async () => {
  const replay = await loadReplayExports();
  assert.equal(typeof replay.buildTransition, 'function');
  assert.equal(typeof replay.buildReplayTrace, 'function');
  if (!replay.buildTransition || !replay.buildReplayTrace) {
    return;
  }

  const transition = replay.buildTransition({
    action: {
      kind: 'scroll',
      position: { x: 320, y: 240 },
      delta_x: 0,
      delta_y: -240,
      target: 'target-app'
    },
    beforeRef: 'screenshots/before.png',
    afterRef: 'screenshots/after.png',
    verification: {
      status: 'passed',
      semanticState: 'success_like',
      winningScreenshotRef: 'screenshots/after-2.png',
      finalStableScreenshotRef: 'screenshots/after-4.png'
    },
    safetyEvent: {
      decision: 'review_required',
      reason: 'needs explicit operator review',
      policyRefs: ['human-review']
    },
    provenance: 'computer_use',
    targetApp: 'mspaint.exe',
    computerUse: {
      callId: 'call_123',
      responseId: 'resp_456',
      previousResponseId: 'resp_455'
    }
  });

  const trace = replay.buildReplayTrace({
    traceId: 'trace_1',
    sessionId: 'session_1',
    targetApp: 'mspaint.exe',
    screenshots: ['screenshots/before.png', 'screenshots/after.png'],
    summaryReport: 'docs/reports/stage-2-paint-demo.md',
    transition,
    verificationPassed: true,
    notes: ['note'],
    computerUse: {
      responseId: 'resp_456',
      previousResponseId: 'resp_455',
      outputRef: 'artifacts/computer-call-output.json'
    }
  }) as {
    steps: Array<{ computerUse?: { callId?: string; responseId?: string; previousResponseId?: string } }>;
    safetyEvents: Array<{ policyRefs?: string[] }>;
    computerUse?: { responseId?: string; previousResponseId?: string; outputRef?: string };
  };

  assert.deepEqual(trace.steps[0]?.computerUse, {
    callId: 'call_123',
    responseId: 'resp_456',
    previousResponseId: 'resp_455'
  });
  assert.deepEqual(trace.safetyEvents[0]?.policyRefs, ['human-review']);
  assert.deepEqual(trace.computerUse, {
    responseId: 'resp_456',
    previousResponseId: 'resp_455',
    outputRef: 'artifacts/computer-call-output.json'
  });
});

test('replay trace schema declares run-level policy refs and computer-use linkage', () => {
  const schemaText = readFileSync(path.resolve('schemas/replay-trace.json'), 'utf8');
  const schema = JSON.parse(schemaText) as unknown;
  const serialized = JSON.stringify(schema);

  assert.match(serialized, /policyRefs/);
  assert.match(serialized, /computerUse/);
  assert.match(serialized, /responseId/);
  assert.match(serialized, /previousResponseId/);
});

test('stage 4 export report documents official call and response linkage', () => {
  const report = readFileSync(path.resolve('docs/reports/stage-4-reusable-capability-export.md'), 'utf8');

  assert.match(report, /call_id/i);
  assert.match(report, /response linkage/i);
  assert.match(report, /policy refs/i);
});
