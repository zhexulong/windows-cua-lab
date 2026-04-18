import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8');
}

test('broker state handle contract exposes foreground snapshots before and after execution', () => {
  const responseModelSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Models/BrokerResponseEnvelope.cs');

  assert.match(responseModelSource, /public sealed class BrokerForegroundWindowSnapshot/);
  assert.match(responseModelSource, /public BrokerForegroundWindowSnapshot\? ForegroundBefore \{ get; set; \}/);
  assert.match(responseModelSource, /public BrokerForegroundWindowSnapshot\? ForegroundAfter \{ get; set; \}/);
  assert.match(responseModelSource, /public string\? Hwnd \{ get; set; \}/);
  assert.match(responseModelSource, /public string\? Pid \{ get; set; \}/);
  assert.match(responseModelSource, /public string\? ProcessName \{ get; set; \}/);
  assert.match(responseModelSource, /public string\? WindowTitle \{ get; set; \}/);
});

test('keyboard injector payload includes foregroundBefore and foregroundAfter snapshots', () => {
  const injectorSource = readWorkspaceFile('windows-broker/src/DesktopBroker/Win32/KeyboardInjectionService.cs');

  assert.match(injectorSource, /\["foregroundBefore"\]\s*=\s*ToBrokerForegroundWindowSnapshot\(foregroundBefore\)/);
  assert.match(injectorSource, /\["foregroundAfter"\]\s*=\s*ToBrokerForegroundWindowSnapshot\(foregroundAfter\)/);
  assert.match(injectorSource, /var foregroundBefore = CaptureForegroundWindowSnapshot\(\);/);
  assert.match(injectorSource, /var foregroundAfter = CaptureForegroundWindowSnapshot\(\);/);
});

test('broker request handler threads foreground snapshots through screenshot, focus, keyboard, and scripted actions', () => {
  const handlerSource = readWorkspaceFile('windows-broker/src/DesktopBroker/BrokerRequestHandler.cs');

  assert.match(handlerSource, /ForegroundBefore = screenshot\.ForegroundBefore,/);
  assert.match(handlerSource, /ForegroundAfter = screenshot\.ForegroundAfter/);
  assert.match(handlerSource, /ForegroundBefore = focusResult\?\.ForegroundBefore,/);
  assert.match(handlerSource, /ForegroundAfter = focusResult\?\.ForegroundAfter/);
  assert.match(handlerSource, /ForegroundBefore = keyboardResult\?\.ForegroundBefore,/);
  assert.match(handlerSource, /ForegroundAfter = keyboardResult\?\.ForegroundAfter/);
  assert.match(handlerSource, /var foregroundBefore = CaptureForegroundWindowSnapshot\(\);/);
  assert.match(handlerSource, /var foregroundAfter = CaptureForegroundWindowSnapshot\(\);/);
  assert.match(handlerSource, /ForegroundBefore = foregroundBefore,/);
  assert.match(handlerSource, /ForegroundAfter = foregroundAfter/);
});

test('runner-side broker response types and replay schema accept foreground snapshots', () => {
  const loopSource = readWorkspaceFile('apps/runner/src/loop.ts');
  const tracesSource = readWorkspaceFile('apps/runner/src/traces.ts');
  const schemaSource = readWorkspaceFile('schemas/transition-envelope.json');

  assert.match(loopSource, /foregroundBefore\?: \{/);
  assert.match(loopSource, /foregroundAfter\?: \{/);
  assert.match(tracesSource, /export interface ForegroundWindowSnapshot/);
  assert.match(tracesSource, /foregroundBefore\?: ForegroundWindowSnapshot;/);
  assert.match(tracesSource, /foregroundAfter\?: ForegroundWindowSnapshot;/);
  assert.match(schemaSource, /"foregroundBefore"/);
  assert.match(schemaSource, /"foregroundAfter"/);
});
