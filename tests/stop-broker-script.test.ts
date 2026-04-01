import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('stop broker script does not assign to PowerShell reserved $PID variable', () => {
  const scriptSource = readWorkspaceFile('windows-broker/scripts/stop-desktop-broker.ps1');

  assert.doesNotMatch(scriptSource, /^\$pid\s*=/im);
  assert.match(scriptSource, /^\$brokerPid\s*=|^\$pidValue\s*=/im);
});

test('stop broker script uses the same runtime pid file path as the start script', () => {
  const stopScriptSource = readWorkspaceFile('windows-broker/scripts/stop-desktop-broker.ps1');
  const startScriptSource = readWorkspaceFile('windows-broker/scripts/start-desktop-broker.ps1');

  const stopRuntimeMatch = stopScriptSource.match(/^\$runtimeDir\s*=\s*Join-Path \$root \"([^\"]+)\"/m);
  const startRuntimeMatch = startScriptSource.match(/^\$runtimeDir\s*=\s*Join-Path \$root \"([^\"]+)\"/m);

  assert.ok(stopRuntimeMatch, 'stop script should define a runtime directory');
  assert.ok(startRuntimeMatch, 'start script should define a runtime directory');
  assert.equal(stopRuntimeMatch?.[1], startRuntimeMatch?.[1]);
  assert.match(stopScriptSource, /^\$pidFile\s*=\s*Join-Path \$runtimeDir \"desktop-broker\.pid\"/m);
});
