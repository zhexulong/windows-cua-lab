import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const loopSource = readFileSync(path.resolve('apps/runner/src/loop.ts'), 'utf8');

test('real-mode activation is process-bound rather than raw title-only AppActivate', () => {
  assert.match(loopSource, /Get-Process\s+-Name/);
  assert.match(loopSource, /MainWindowHandle\s+-ne\s+0/);
  assert.match(loopSource, /AppActivate\(\$ready\.Id\)/);
  assert.doesNotMatch(loopSource, /AppActivate\(\$\{titleTarget\}\)/);
});

test('real-mode activation rejects missing ready windows instead of trusting a loose title match', () => {
  assert.match(loopSource, /Unable to find a ready window/);
});
