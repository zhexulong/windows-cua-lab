import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('broker health endpoint exposes the DesktopBroker process id', () => {
  const programSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Program.cs');

  assert.match(programSource, /app\.MapGet\("\/health"/);
  assert.match(programSource, /processId\s*=\s*Environment\.ProcessId|processId\s*=\s*Process\.GetCurrentProcess\(\)\.Id/);
});

test('foreground grant helper resolves broker pid from health and grants foreground permission', () => {
  const scriptSource = readWorkspaceFile('windows-broker/scripts/grant-broker-foreground.ps1');

  assert.match(scriptSource, /param\(/);
  assert.match(scriptSource, /\[string\]\$Endpoint\s*=\s*"http:\/\/127\.0\.0\.1:10578"/);
  assert.match(scriptSource, /Invoke-RestMethod\s+-Method\s+Get\s+-Uri\s+"\$Endpoint\/health"/);
  assert.match(scriptSource, /AllowSetForegroundWindow/);
  assert.match(scriptSource, /GetForegroundWindow/);
  assert.match(scriptSource, /GetWindowThreadProcessId/);
  assert.match(scriptSource, /GetWindowText/);
  assert.match(scriptSource, /foregroundProcessName/);
  assert.match(scriptSource, /grantSucceeded/);
});
