import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('generic screenshot verifier reads AI responses through the shared stream path', () => {
  const loopSource = readWorkspaceFile('apps/runner/src/loop.ts');
  const verifierSlice = loopSource.slice(loopSource.indexOf('export async function classifyGenericScreenshotPair'));

  assert.match(verifierSlice, /const streamed = body\.stream === true;/);
  assert.match(verifierSlice, /const rawText = await readResponseText\(response, streamed\);/);
  assert.match(verifierSlice, /const extraction = streamed\s*\?\s*extractStreamedOutputText/);
});
