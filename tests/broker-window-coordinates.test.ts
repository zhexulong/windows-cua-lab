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

test('broker routes double_click through the click script with click count 2', () => {
  const handlerSource = readWorkspaceFile('windows-broker/src/DesktopBroker/BrokerRequestHandler.cs');

  assert.match(handlerSource, /"double_click"\s*=>\s*await\s+HandleDoubleClickAsync\(/);
  assert.match(handlerSource, /private\s+Task<BrokerResponseEnvelope>\s+HandleDoubleClickAsync\(/);
  assert.match(handlerSource, /\("ClickCount",\s*"2"\)/);
  assert.match(handlerSource, /"invoke-click\.ps1"/);
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

test('click script supports bounded atomic multi-click execution', () => {
  const scriptSource = readWorkspaceFile('windows-broker/scripts/invoke-click.ps1');

  assert.match(scriptSource, /\[int\]\$ClickCount\s*=\s*1/);
  assert.match(scriptSource, /GetDoubleClickTime/);
  assert.match(scriptSource, /for\s*\(\$clickIndex\s*=\s*0;\s*\$clickIndex\s*-lt\s*\$ClickCount;\s*\$clickIndex\+\+\)/);
  assert.match(scriptSource, /if\s*\(\$clickIndex\s*-lt\s*\(\$ClickCount\s*-\s*1\)\)/);
  assert.match(scriptSource, /clickCount\s*=\s*\$ClickCount/);
});

test('broker contract and transition schema support first-class double_click actions', () => {
  const contractSource = readWorkspaceFile('windows-broker/contract.md');
  const schemaSource = readWorkspaceFile('schemas/transition-envelope.json');

  assert.match(contractSource, /###\s+`double_click`/);
  assert.match(contractSource, /-\s+`kind:\s+"double_click"`/);
  assert.match(contractSource, /-\s+`button`\s+and\s+`position`\s+when\s+`kind`\s+is\s+`double_click`/);
  assert.match(schemaSource, /"double_click"/);
  assert.match(schemaSource, /"const":\s*"double_click"/);
});

test('broker routes move and scroll through dedicated handlers', () => {
  const handlerSource = readWorkspaceFile('windows-broker/src/DesktopBroker/BrokerRequestHandler.cs');

  assert.match(handlerSource, /"move"\s*=>\s*await\s+HandleMoveAsync\(/);
  assert.match(handlerSource, /"scroll"\s*=>\s*await\s+HandleScrollAsync\(/);
  assert.match(handlerSource, /private\s+Task<BrokerResponseEnvelope>\s+HandleMoveAsync\(/);
  assert.match(handlerSource, /private\s+Task<BrokerResponseEnvelope>\s+HandleScrollAsync\(/);
});

test('broker scripts include bounded move and scroll execution entrypoints', () => {
  const moveScriptSource = readWorkspaceFile('windows-broker/scripts/invoke-move.ps1');
  const scrollScriptSource = readWorkspaceFile('windows-broker/scripts/invoke-scroll.ps1');

  assert.match(moveScriptSource, /param\(/);
  assert.match(moveScriptSource, /SetCursorPos/);
  assert.match(scrollScriptSource, /param\(/);
  assert.match(scrollScriptSource, /mouse_event/);
});

test('broker forwards expected target app to keyboard and type execution', () => {
  const handlerSource = readWorkspaceFile('windows-broker/src/DesktopBroker/BrokerRequestHandler.cs');

  assert.match(handlerSource, /HandleTypeAsync[\s\S]*\("TargetApp",\s*ExtractExpectedTargetApp\(request\)\)/);
  assert.match(handlerSource, /HandleHotkeyAsync[\s\S]*\("TargetApp",\s*ExtractExpectedTargetApp\(request\)\)/);
  assert.match(handlerSource, /HandleKeypressAsync[\s\S]*\("TargetApp",\s*ExtractExpectedTargetApp\(request\)\)/);
});

test('keyboard scripts activate the target app before sending keys', () => {
  const hotkeyScriptSource = readWorkspaceFile('windows-broker/scripts/invoke-hotkey.ps1');
  const typeScriptSource = readWorkspaceFile('windows-broker/scripts/invoke-type.ps1');

  assert.match(hotkeyScriptSource, /\[string\]\$TargetApp\s*=\s*""/);
  assert.match(hotkeyScriptSource, /New-Object -ComObject WScript\.Shell/);
  assert.match(hotkeyScriptSource, /AppActivate\(/);

  assert.match(typeScriptSource, /\[string\]\$TargetApp\s*=\s*""/);
  assert.match(typeScriptSource, /New-Object -ComObject WScript\.Shell/);
  assert.match(typeScriptSource, /AppActivate\(/);
});

test('broker keyboard cutover removes SendKeys as the primary execution backend', () => {
  const hotkeyScriptSource = readWorkspaceFile('windows-broker/scripts/invoke-hotkey.ps1');
  const typeScriptSource = readWorkspaceFile('windows-broker/scripts/invoke-type.ps1');

  assert.doesNotMatch(hotkeyScriptSource, /SendKeys\.SendWait/);
  assert.doesNotMatch(typeScriptSource, /SendKeys\.SendWait/);
});
