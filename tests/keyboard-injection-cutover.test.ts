import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('broker-native keyboard injector service is registered', () => {
  const programSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Program.cs');

  assert.match(programSource, /AddSingleton<KeyboardInjectionService>/);
});

test('keyboard injector service source exists and uses SendInput', () => {
  const injectorSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Win32/KeyboardInjectionService.cs');

  assert.match(injectorSource, /SendInput/);
});

test('keyboard injector uses a concrete Windows MapVirtualKey entrypoint', () => {
  const injectorSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Win32/KeyboardInjectionService.cs');

  assert.match(injectorSource, /EntryPoint\s*=\s*"MapVirtualKeyW"/);
});

test('keyboard injector exposes a focus-only path that does not inject keys', () => {
  const injectorSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Win32/KeyboardInjectionService.cs');

  assert.match(injectorSource, /internal\s+async\s+Task<string>\s+FocusAsync\(string targetApp, CancellationToken cancellationToken\)/);
  assert.match(injectorSource, /CreateActivationPayload\("focused",\s*"SetForegroundWindow",\s*activation,\s*foregroundBefore,\s*foregroundAfter\)/);
  assert.match(injectorSource, /Type\.GetTypeFromProgID\("WScript\.Shell"\)/);
  assert.match(injectorSource, /AppActivate/);
});

test('keyboard injector focus path uses thread-input attachment and window activation primitives', () => {
  const injectorSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Win32/KeyboardInjectionService.cs');

  assert.match(injectorSource, /AttachThreadInput/);
  assert.match(injectorSource, /GetCurrentThreadId/);
  assert.match(injectorSource, /SetActiveWindow/);
  assert.match(injectorSource, /BringWindowToTop/);
  assert.match(injectorSource, /for \(var attempt = 0; attempt < \d+; attempt \+= 1\)/);
});

test('keyboard injector reports the underlying Win32 error when SendInput fails', () => {
  const injectorSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Win32/KeyboardInjectionService.cs');

  assert.match(injectorSource, /Marshal\.GetLastWin32Error\(/);
  assert.match(injectorSource, /Win32Error=\{error\}/);
});

test('keyboard injection models define the full Win32 INPUT union shape', () => {
  const modelsSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Win32/KeyboardInjectionModels.cs');

  assert.match(modelsSource, /struct\s+MOUSEINPUT/);
  assert.match(modelsSource, /struct\s+HARDWAREINPUT/);
  assert.match(modelsSource, /public\s+MOUSEINPUT\s+mi;/);
  assert.match(modelsSource, /public\s+HARDWAREINPUT\s+hi;/);
});

test('keyboard actions no longer shell out to invoke-hotkey or invoke-type scripts', () => {
  const handlerSource = readWorkspaceFile('windows-broker/src/DesktopBroker/BrokerRequestHandler.cs');

  assert.doesNotMatch(handlerSource, /"invoke-hotkey\.ps1"/);
  assert.doesNotMatch(handlerSource, /"invoke-type\.ps1"/);
});

test('legacy keyboard PowerShell scripts are explicitly marked deprecated if retained', () => {
  const hotkeyScriptSource = readWorkspaceFile('windows-broker/scripts/invoke-hotkey.ps1');
  const typeScriptSource = readWorkspaceFile('windows-broker/scripts/invoke-type.ps1');

  assert.match(hotkeyScriptSource, /DEPRECATED/i);
  assert.match(typeScriptSource, /DEPRECATED/i);
  assert.match(hotkeyScriptSource, /SendInput/i);
  assert.match(typeScriptSource, /SendInput/i);
});
