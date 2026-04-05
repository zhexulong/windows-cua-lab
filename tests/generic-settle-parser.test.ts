import test from 'node:test';
import assert from 'node:assert/strict';

import * as loop from '../dist/apps/runner/src/loop.js';

test('parseGenericSettleClassificationJson tolerates truncated JSON by degrading to ambiguous instead of throwing', () => {
  const parseGenericSettleClassificationJson = (
    loop as typeof loop & {
      parseGenericSettleClassificationJson?: (outputText: string) => {
        semanticState: 'success_like' | 'failure_like' | 'loading' | 'ambiguous';
        summary: string;
      };
    }
  ).parseGenericSettleClassificationJson;

  assert.equal(typeof parseGenericSettleClassificationJson, 'function');
  if (!parseGenericSettleClassificationJson) {
    return;
  }

  const result = parseGenericSettleClassificationJson('{"semanticState":"loading","summary":"The UI is still changing');

  assert.equal(result.semanticState, 'ambiguous');
  assert.match(result.summary, /incomplete|truncated|parse/i);
});
