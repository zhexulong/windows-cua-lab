import test from 'node:test';
import assert from 'node:assert/strict';

import { selectHigherInformationGenericAction } from '../apps/runner/src/generic-probe-selection.ts';

test('replaces low-information Paint palette clicks with a higher-information canvas drag probe', () => {
  const result = selectHigherInformationGenericAction({
    targetApp: 'mspaint.exe',
    summary: 'Click the bright yellow color swatch in the Colors palette.',
    action: {
      kind: 'click',
      button: 'left',
      position: { x: 731, y: 287 },
      target: 'bright yellow color swatch in the Colors palette'
    }
  });

  assert.equal(result.action.kind, 'drag');
  assert.equal(result.action.target, 'paint-canvas');
  assert.match(result.summary, /higher-information/i);
});

test('keeps non-paint actions unchanged', () => {
  const result = selectHigherInformationGenericAction({
    targetApp: 'notepad.exe',
    summary: 'Click the Help menu.',
    action: {
      kind: 'click',
      button: 'left',
      position: { x: 40, y: 40 },
      target: 'Help menu'
    }
  });

  assert.equal(result.action.kind, 'click');
  assert.equal(result.action.target, 'Help menu');
});
