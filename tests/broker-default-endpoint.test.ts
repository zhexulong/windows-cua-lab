import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('windows-cua-lab defaults to broker port 10578 across runtime and operator entrypoints', () => {
  const loopSource = readWorkspaceFile('apps/runner/src/loop.ts');
  const preflightSource = readWorkspaceFile('scripts/preflight-windows.mjs');
  const startScriptSource = readWorkspaceFile('windows-broker/scripts/start-desktop-broker.ps1');
  const testScriptSource = readWorkspaceFile('windows-broker/scripts/test-desktop-broker.ps1');

  assert.match(loopSource, /DEFAULT_REAL_BROKER_ENDPOINT\s*=\s*'http:\/\/127\.0\.0\.1:10578'/);
  assert.match(preflightSource, /WINDOWS_BROKER_ENDPOINT\s*\?\?\s*'http:\/\/127\.0\.0\.1:10578'/);
  assert.match(startScriptSource, /\[int\]\$Port = 10578/);
  assert.match(testScriptSource, /\[string\]\$Endpoint = "http:\/\/127\.0\.0\.1:10578"/);
});
