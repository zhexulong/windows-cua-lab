import test from 'node:test';
import assert from 'node:assert/strict';

import * as loop from '../dist/apps/runner/src/loop.js';
import { applyActionToCanvas, canvasToPngBuffer, cloneCanvas, createPaintCanvas } from '../dist/apps/runner/src/traces.js';
import type { BrokerAction } from '../apps/runner/src/traces.ts';

test('generic settle runtime always judges after-0 once, gates redundant samples, and returns richer verification evidence', async () => {
  const settleAndVerifyGenericAction = (
    loop as typeof loop & {
      settleAndVerifyGenericAction?: (params: {
        beforeScreenshot: Buffer;
        captureScreenshotAtOffset: (offsetMs: number) => Promise<{ buffer: Buffer; screenshotRef: string }>;
        classifyScreenshotPair: (input: { before: Buffer; candidate: Buffer; offsetMs: number }) => Promise<{
          semanticState: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
          summary: string;
        }>;
        action: BrokerAction;
        beforeRef: string;
      }) => Promise<{
        verification: {
          status: 'passed' | 'failed' | 'unknown';
          method?: string;
          summary?: string;
          semanticState?: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
          winningScreenshotRef?: string;
          finalStableScreenshotRef?: string;
          evidenceRefs?: string[];
        };
        traceEntries: Array<{
          offsetMs?: number;
          screenshotRef?: string;
          aiInvoked?: boolean;
          semanticState?: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
          changedPixelsFromPrevious?: number;
        }>;
      }>;
    }
  ).settleAndVerifyGenericAction;

  assert.equal(typeof settleAndVerifyGenericAction, 'function');
  if (!settleAndVerifyGenericAction) {
    return;
  }

  const action: BrokerAction = {
    kind: 'double_click',
    button: 'left',
    position: { x: 48, y: 34 },
    target: 'Host card 10.19.138.75'
  };

  const beforeCanvas = createPaintCanvas(96, 72);
  const beforeScreenshot = canvasToPngBuffer(beforeCanvas);

  const after0Canvas = applyActionToCanvas(beforeCanvas, action);
  const after250Canvas = cloneCanvas(after0Canvas);

  const after500Canvas = cloneCanvas(after0Canvas);
  paintBlock(after500Canvas, 18, 18, 8, [34, 34, 34]);

  const after1000Canvas = cloneCanvas(after500Canvas);

  const after1500Canvas = cloneCanvas(after500Canvas);

  const frames = new Map<number, { buffer: Buffer; screenshotRef: string }>([
    [0, { buffer: canvasToPngBuffer(after0Canvas), screenshotRef: 'screenshots/step-1-after-0.png' }],
    [250, { buffer: canvasToPngBuffer(after250Canvas), screenshotRef: 'screenshots/step-1-after-1.png' }],
    [500, { buffer: canvasToPngBuffer(after500Canvas), screenshotRef: 'screenshots/step-1-after-2.png' }],
    [1000, { buffer: canvasToPngBuffer(after1000Canvas), screenshotRef: 'screenshots/step-1-after-3.png' }],
    [1500, { buffer: canvasToPngBuffer(after1500Canvas), screenshotRef: 'screenshots/step-1-after-4.png' }]
  ]);

  const capturedOffsets: number[] = [];
  const judgedOffsets: number[] = [];

  const result = await settleAndVerifyGenericAction({
    beforeScreenshot,
    beforeRef: 'screenshots/step-0-before.png',
    action,
    captureScreenshotAtOffset: async (offsetMs: number) => {
      capturedOffsets.push(offsetMs);
      const frame = frames.get(offsetMs);
      assert.ok(frame, `missing frame for ${offsetMs}ms`);
      return frame;
    },
    classifyScreenshotPair: async ({ offsetMs }: { before: Buffer; candidate: Buffer; offsetMs: number }) => {
      judgedOffsets.push(offsetMs);

      if (offsetMs === 0) {
        return {
          semanticState: 'loading',
          summary: 'The immediate post-action frame still looks like a connecting/loading scene.'
        };
      }

      if (offsetMs === 500) {
        return {
          semanticState: 'success_like',
          summary: 'A session-like terminal view is visible.'
        };
      }

      assert.fail(`semantic judge should not run at ${offsetMs}ms`);
    }
  });

  assert.deepEqual(capturedOffsets, [0, 250, 500, 1000, 1500]);
  assert.deepEqual(judgedOffsets, [0, 500]);

  assert.equal(result.verification.status, 'passed');
  assert.equal(result.verification.method, 'semantic-settle-window');
  assert.equal(result.verification.semanticState, 'success_like');
  assert.equal(result.verification.winningScreenshotRef, 'screenshots/step-1-after-2.png');
  assert.equal(result.verification.finalStableScreenshotRef, 'screenshots/step-1-after-4.png');
  assert.deepEqual(result.verification.evidenceRefs, [
    'screenshots/step-1-after-0.png',
    'screenshots/step-1-after-2.png',
    'screenshots/step-1-after-4.png'
  ]);
  assert.match(result.verification.summary ?? '', /session-like terminal view/i);

  const sampleEntries = result.traceEntries.filter((entry) => typeof entry.offsetMs === 'number');
  assert.equal(sampleEntries.length, 5);
  assert.deepEqual(
    sampleEntries.map((entry) => [entry.offsetMs, entry.aiInvoked, entry.semanticState]),
    [
      [0, true, 'loading'],
      [250, false, 'loading'],
      [500, true, 'success_like'],
      [1000, false, 'success_like'],
      [1500, false, 'success_like']
    ]
  );
  assert.equal(sampleEntries[1]?.changedPixelsFromPrevious! < 25, true);
  assert.equal(sampleEntries[2]?.changedPixelsFromPrevious! >= 25, true);
});

test('generic settle runtime does not blindly reuse degraded verifier ambiguity across gated frames and lets later semantic truth win', async () => {
  const settleAndVerifyGenericAction = (
    loop as typeof loop & {
      settleAndVerifyGenericAction?: (params: {
        beforeScreenshot: Buffer;
        captureScreenshotAtOffset: (offsetMs: number) => Promise<{ buffer: Buffer; screenshotRef: string }>;
        classifyScreenshotPair: (input: { before: Buffer; candidate: Buffer; offsetMs: number }) => Promise<{
          semanticState: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
          summary: string;
          classificationKind?:
            | 'semantic_success_like'
            | 'semantic_failure_like'
            | 'semantic_loading'
            | 'semantic_ambiguous'
            | 'verifier_empty_response'
            | 'verifier_parse_failure'
            | 'verifier_timeout'
            | 'verifier_shape_mismatch';
        }>;
        action: BrokerAction;
        beforeRef: string;
      }) => Promise<{
        verification: {
          status: 'passed' | 'failed' | 'unknown';
          method?: string;
          summary?: string;
          semanticState?: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
          winningScreenshotRef?: string;
          finalStableScreenshotRef?: string;
          evidenceRefs?: string[];
        };
        traceEntries: Array<{
          offsetMs?: number;
          screenshotRef?: string;
          aiInvoked?: boolean;
          semanticState?: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
          summary?: string;
          changedPixelsFromPrevious?: number;
        }>;
      }>;
    }
  ).settleAndVerifyGenericAction;

  assert.equal(typeof settleAndVerifyGenericAction, 'function');
  if (!settleAndVerifyGenericAction) {
    return;
  }

  const action: BrokerAction = {
    kind: 'double_click',
    button: 'left',
    position: { x: 48, y: 34 },
    target: 'Host card 10.19.138.75'
  };

  const beforeCanvas = createPaintCanvas(96, 72);
  const beforeScreenshot = canvasToPngBuffer(beforeCanvas);

  const after0Canvas = applyActionToCanvas(beforeCanvas, action);
  const after250Canvas = cloneCanvas(after0Canvas);

  const after500Canvas = cloneCanvas(after0Canvas);
  paintBlock(after500Canvas, 18, 18, 8, [34, 34, 34]);

  const after1000Canvas = cloneCanvas(after500Canvas);
  const after1500Canvas = cloneCanvas(after500Canvas);

  const frames = new Map<number, { buffer: Buffer; screenshotRef: string }>([
    [0, { buffer: canvasToPngBuffer(after0Canvas), screenshotRef: 'screenshots/step-1-after-0.png' }],
    [250, { buffer: canvasToPngBuffer(after250Canvas), screenshotRef: 'screenshots/step-1-after-1.png' }],
    [500, { buffer: canvasToPngBuffer(after500Canvas), screenshotRef: 'screenshots/step-1-after-2.png' }],
    [1000, { buffer: canvasToPngBuffer(after1000Canvas), screenshotRef: 'screenshots/step-1-after-3.png' }],
    [1500, { buffer: canvasToPngBuffer(after1500Canvas), screenshotRef: 'screenshots/step-1-after-4.png' }]
  ]);

  const result = await settleAndVerifyGenericAction({
    beforeScreenshot,
    beforeRef: 'screenshots/step-0-before.png',
    action,
    captureScreenshotAtOffset: async (offsetMs: number) => {
      const frame = frames.get(offsetMs);
      assert.ok(frame, `missing frame for ${offsetMs}ms`);
      return frame;
    },
    classifyScreenshotPair: async ({ offsetMs }: { before: Buffer; candidate: Buffer; offsetMs: number }) => {
      if (offsetMs === 0) {
        return {
          semanticState: 'ambiguous',
          classificationKind: 'verifier_parse_failure',
          summary: 'Settle verifier parse failure: extracted verifier text could not be decoded as JSON.'
        };
      }

      if (offsetMs === 500) {
        return {
          semanticState: 'success_like',
          classificationKind: 'semantic_success_like',
          summary: 'A session-like terminal view is visible.'
        };
      }

      assert.fail(`semantic judge should not run at ${offsetMs}ms`);
    }
  });

  assert.equal(result.verification.status, 'passed');
  assert.equal(result.verification.semanticState, 'success_like');
  assert.equal(result.verification.winningScreenshotRef, 'screenshots/step-1-after-2.png');
  assert.equal(result.verification.finalStableScreenshotRef, 'screenshots/step-1-after-4.png');
  assert.deepEqual(result.verification.evidenceRefs, [
    'screenshots/step-1-after-0.png',
    'screenshots/step-1-after-2.png',
    'screenshots/step-1-after-4.png'
  ]);

  const sampleEntries = result.traceEntries.filter((entry) => typeof entry.offsetMs === 'number');
  assert.deepEqual(
    sampleEntries.map((entry) => [entry.offsetMs, entry.aiInvoked, entry.semanticState]),
    [
      [0, true, 'ambiguous'],
      [250, false, undefined],
      [500, true, 'success_like'],
      [1000, false, 'success_like'],
      [1500, false, 'success_like']
    ]
  );
  assert.match(sampleEntries[1]?.summary ?? '', /reusing degraded verifier result verifier_parse_failure/i);
});

function paintBlock(
  canvas: ReturnType<typeof createPaintCanvas>,
  startX: number,
  startY: number,
  size: number,
  color: [number, number, number]
): void {
  for (let y = startY; y < startY + size; y += 1) {
    for (let x = startX; x < startX + size; x += 1) {
      canvas.pixels[y]![x] = [...color];
    }
  }
}
