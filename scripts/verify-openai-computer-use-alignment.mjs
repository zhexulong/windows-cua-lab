#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

function assertIncludes(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
const replaySchema = readFileSync(path.join(repoRoot, 'schemas', 'replay-trace.json'), 'utf8');
const transitionSchema = readFileSync(path.join(repoRoot, 'schemas', 'transition-envelope.json'), 'utf8');
const brokerProgram = readFileSync(path.join(repoRoot, 'windows-broker', 'src', 'DesktopBroker', 'Program.cs'), 'utf8');
const brokerHandler = readFileSync(path.join(repoRoot, 'windows-broker', 'src', 'DesktopBroker', 'BrokerRequestHandler.cs'), 'utf8');
const keyboardService = readFileSync(path.join(repoRoot, 'windows-broker', 'src', 'DesktopBroker', 'Win32', 'KeyboardInjectionService.cs'), 'utf8');

assertIncludes(readme, 'alignment is currently **in progress**', 'README must clearly state that full OpenAI Computer Use alignment is still in progress until acceptance is complete.');
assertIncludes(readme, 'http://127.0.0.1:10578', 'README must document broker default 10578.');
assertIncludes(transitionSchema, 'keypress', 'transition schema must include keypress.');
assertIncludes(transitionSchema, 'move', 'transition schema must include move.');
assertIncludes(transitionSchema, 'scroll', 'transition schema must include scroll.');
assertIncludes(replaySchema, 'computerUse', 'replay schema must include computerUse linkage.');
assertIncludes(brokerProgram, 'AddSingleton<KeyboardInjectionService>', 'Windows broker must register KeyboardInjectionService.');
assertIncludes(keyboardService, 'SendInput', 'KeyboardInjectionService must use SendInput.');

if (brokerHandler.includes('"invoke-hotkey.ps1"') || brokerHandler.includes('"invoke-type.ps1"')) {
  throw new Error('Broker keyboard handlers must not shell out to invoke-hotkey.ps1 or invoke-type.ps1.');
}

run('npm', ['run', 'build']);
run('node', ['--test', 'tests/openai-computer-use-contract.test.ts', 'tests/ai-transport-hardening.test.ts', 'tests/openai-action-vocabulary.test.ts', 'tests/replay-trace-fidelity.test.ts', 'tests/broker-window-coordinates.test.ts', 'tests/keyboard-injection-cutover.test.ts']);
run('npm', ['run', 'test:stage2']);
run('npm', ['run', 'test:stage3']);

console.log('windows-cua-lab OpenAI Computer Use alignment acceptance checks passed.');
