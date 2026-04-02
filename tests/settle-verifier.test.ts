import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSettleSchedule,
  selectBestEvidenceSample,
  shouldInvokeSemanticJudge,
  type SettleSample
} from '../apps/runner/src/settle-verifier.ts';

test('success-like first frame exits without settle follow-ups', () => {
  const result = buildSettleSchedule({ firstSemanticState: 'success_like' });

  assert.equal(result.shouldSettle, false);
  assert.deepEqual(result.offsetsMs, []);
});

test('loading first frame enters settle mode with bounded follow-up offsets', () => {
  const result = buildSettleSchedule({ firstSemanticState: 'loading' });

  assert.equal(result.shouldSettle, true);
  assert.deepEqual(result.offsetsMs, [250, 500, 1000, 1500]);
});

test('tiny follow-up diff is skipped by the pixel gate', () => {
  assert.equal(
    shouldInvokeSemanticJudge({ changedPixels: 5, changedBytes: 12 }),
    false
  );
});

test('meaningful follow-up diff re-enters semantic judgment', () => {
  assert.equal(
    shouldInvokeSemanticJudge({ changedPixels: 25, changedBytes: 64 }),
    true
  );
});

test('byte-only gate path still triggers semantic judgment', () => {
  assert.equal(
    shouldInvokeSemanticJudge({ changedPixels: 24, changedBytes: 64 }),
    true
  );
});

test('best evidence sample and final stable sample are selected separately', () => {
  const samples: SettleSample[] = [
    {
      offsetMs: 0,
      screenshotRef: 'screenshots/after-0.png',
      changedPixelsFromBefore: 180,
      changedBytesFromBefore: 512,
      semanticState: 'loading',
      semanticSummary: 'Still connecting',
      aiInvoked: true
    },
    {
      offsetMs: 500,
      screenshotRef: 'screenshots/after-500.png',
      changedPixelsFromBefore: 260,
      changedBytesFromBefore: 900,
      changedPixelsFromPrevious: 60,
      changedBytesFromPrevious: 160,
      semanticState: 'success_like',
      semanticSummary: 'Terminal session visible',
      aiInvoked: true
    },
    {
      offsetMs: 1500,
      screenshotRef: 'screenshots/after-1500.png',
      changedPixelsFromBefore: 268,
      changedBytesFromBefore: 928,
      changedPixelsFromPrevious: 3,
      changedBytesFromPrevious: 12,
      aiInvoked: false
    }
  ];

  const result = selectBestEvidenceSample(samples);

  assert.equal(result.winningSample?.screenshotRef, 'screenshots/after-500.png');
  assert.equal(result.finalStableSample?.screenshotRef, 'screenshots/after-1500.png');
});

test('empty samples return no winning or final sample', () => {
  const result = selectBestEvidenceSample([]);

  assert.equal(result.winningSample, undefined);
  assert.equal(result.finalStableSample, undefined);
});
