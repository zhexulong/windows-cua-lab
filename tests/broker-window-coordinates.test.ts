import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('broker forwards screenshot scope and target to the screenshot script', () => {
  const handlerSource = readWorkspaceFile('windows-broker/src/DesktopBroker/BrokerRequestHandler.cs');

  assert.match(handlerSource, /InvokeScriptAsync\(\s*"capture-screenshot\.ps1",\s*\[/s);
  assert.match(handlerSource, /\("Scope",\s*request\.Action\.Scope\s*\?\?\s*"window"\)/);
  assert.match(handlerSource, /\("Target",\s*request\.Action\.Target\s*\?\?\s*string\.Empty\)/);
});

test('broker forwards expected target app to click execution for window-relative clicks', () => {
  const handlerSource = readWorkspaceFile('windows-broker/src/DesktopBroker/BrokerRequestHandler.cs');

  assert.match(handlerSource, /\("TargetApp",\s*ExtractExpectedTargetApp\(request\)\)/);
  assert.match(handlerSource, /private\s+static\s+string\s+ExtractExpectedTargetApp\(BrokerRequestEnvelope request\)/);
});

test('capture screenshot script supports dpi-aware window capture', () => {
  const scriptSource = readWorkspaceFile('windows-broker/scripts/capture-screenshot.ps1');

  assert.match(scriptSource, /param\(/);
  assert.match(scriptSource, /\[string\]\$Scope\s*=\s*"window"/);
  assert.match(scriptSource, /\[string\]\$Target/);
  assert.match(scriptSource, /SetProcessDPIAware/);
  assert.match(scriptSource, /GetWindowRect/);
  assert.doesNotMatch(scriptSource, /\$bounds = \[System\.Windows\.Forms\.Screen\]::PrimaryScreen\.Bounds\s*$/m);
});

test('click script normalizes window-relative coordinates using target app bounds', () => {
  const scriptSource = readWorkspaceFile('windows-broker/scripts/invoke-click.ps1');

  assert.match(scriptSource, /\[string\]\$TargetApp\s*=\s*""/);
  assert.match(scriptSource, /SetProcessDPIAware/);
  assert.match(scriptSource, /GetWindowRect/);
  assert.match(scriptSource, /\$screenX\s*=\s*\$windowRect\.Left\s*\+\s*\$X/);
  assert.match(scriptSource, /\$screenY\s*=\s*\$windowRect\.Top\s*\+\s*\$Y/);
  assert.match(scriptSource, /SetCursorPos\(\$screenX,\s*\$screenY\)/);
});
