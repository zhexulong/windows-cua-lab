import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { verifyPaintStep } from '../dist/apps/runner/src/verifier.js';
import { canvasToPngBuffer, cloneCanvas, createPaintCanvas } from '../dist/apps/runner/src/traces.js';

test('verifyPaintStep rejects tiny localized visual diffs', () => {
  const beforeCanvas = createPaintCanvas(64, 48);
  const afterCanvas = cloneCanvas(beforeCanvas);

  for (let y = 10; y < 13; y += 1) {
    for (let x = 10; x < 13; x += 1) {
      afterCanvas.pixels[y]![x] = [80, 87, 102];
    }
  }

  const result = verifyPaintStep({
    beforeScreenshot: canvasToPngBuffer(beforeCanvas),
    afterScreenshot: canvasToPngBuffer(afterCanvas),
    action: {
      kind: 'click',
      button: 'left',
      position: { x: 11, y: 11 },
      target: 'tiny-highlight'
    },
    beforeRef: 'screenshots/before.png',
    afterRef: 'screenshots/after.png'
  });

  assert.equal(result.verification.status, 'failed');
  assert.match(result.verification.summary ?? '', /No meaningful visible screenshot change detected/i);
  assert.equal(result.safetyEvent.decision, 'review_required');
});

test('verifyPaintStep accepts meaningful pane-sized visual diffs', () => {
  const beforeCanvas = createPaintCanvas(64, 48);
  const afterCanvas = cloneCanvas(beforeCanvas);

  for (let y = 10; y < 22; y += 1) {
    for (let x = 10; x < 22; x += 1) {
      afterCanvas.pixels[y]![x] = [80, 87, 102];
    }
  }

  const result = verifyPaintStep({
    beforeScreenshot: canvasToPngBuffer(beforeCanvas),
    afterScreenshot: canvasToPngBuffer(afterCanvas),
    action: {
      kind: 'click',
      button: 'left',
      position: { x: 16, y: 16 },
      target: 'pane-change'
    },
    beforeRef: 'screenshots/before.png',
    afterRef: 'screenshots/after.png'
  });

  assert.equal(result.verification.status, 'passed');
  assert.match(result.verification.summary ?? '', /Detected \d+ changed pixels/i);
  assert.equal(result.safetyEvent.decision, 'allowed');
});

test('verifyPaintStep supports RGBA screenshots from real Termius runs', () => {
  const beforeScreenshot = fs.readFileSync(
    path.resolve('artifacts/custom-termius-exe/screenshots/step-0-before.png')
  );
  const afterScreenshot = fs.readFileSync(
    path.resolve('artifacts/custom-termius-exe/screenshots/step-1-after.png')
  );

  assert.doesNotThrow(() =>
    verifyPaintStep({
      beforeScreenshot,
      afterScreenshot,
      action: {
        kind: 'click',
        button: 'left',
        position: { x: 554, y: 196 },
        target: 'Keychain sidebar item'
      },
      beforeRef: 'screenshots/step-0-before.png',
      afterRef: 'screenshots/step-1-after.png'
    })
  );
});
