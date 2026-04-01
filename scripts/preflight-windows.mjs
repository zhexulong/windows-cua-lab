#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const DEFAULT_TARGET_APP = 'notepad.exe';
const DEFAULT_WINDOW_TITLE = 'Notepad';

async function main() {
  loadEnvFiles(['.env.local', '.env']);

  const args = process.argv.slice(2);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    printHelp();
    process.exit(0);
  }

  const targetApp = readFlag(args, '--target-app') ?? DEFAULT_TARGET_APP;
  const windowTitle = readFlag(args, '--window-title') ?? DEFAULT_WINDOW_TITLE;
  const brokerEndpoint = process.env.WINDOWS_BROKER_ENDPOINT ?? 'http://127.0.0.1:10578';
  const brokerApiKey = process.env.WINDOWS_BROKER_API_KEY;
  const skipAppActivation = hasFlag(args, '--skip-app-activation');
  const skipGateway = hasFlag(args, '--skip-gateway');

  const checks = [];

  checks.push(checkNodeVersion());
  checks.push(checkBrokerEndpointConfig(process.env.WINDOWS_BROKER_ENDPOINT, brokerEndpoint));

  if (!skipGateway) {
    checks.push(checkEnvPresent('URL', process.env.URL));
    checks.push(checkEnvPresent('KEY', process.env.KEY));
  }

  checks.push(checkPowerShellAvailable());

  const brokerResult = await checkBrokerHealth({
    endpoint: brokerEndpoint,
    apiKey: brokerApiKey
  });
  checks.push(brokerResult);

  if (!skipAppActivation) {
    checks.push(checkAppActivation({ targetApp, windowTitle }));
  }

  printResults(checks, {
    targetApp,
    windowTitle,
    brokerEndpoint,
    skipGateway,
    skipAppActivation
  });

  const failed = checks.some((item) => !item.ok);
  process.exit(failed ? 1 : 0);
}

function loadEnvFiles(files) {
  for (const file of files) {
    if (!fs.existsSync(file)) {
      continue;
    }

    const content = fs.readFileSync(file, 'utf8');
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separator = line.indexOf('=');
      if (separator <= 0) {
        continue;
      }

      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

function checkNodeVersion() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (major >= 18) {
    return ok('Node.js version', `Detected ${process.versions.node}`);
  }
  return fail('Node.js version', `Detected ${process.versions.node}. Node 18+ is required.`);
}

function checkEnvPresent(name, value) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return ok(`Env ${name}`, 'configured');
  }
  return fail(`Env ${name}`, 'missing');
}

function checkBrokerEndpointConfig(rawValue, effectiveValue) {
  if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
    return ok('Env WINDOWS_BROKER_ENDPOINT', `configured (${effectiveValue})`);
  }
  return ok('Env WINDOWS_BROKER_ENDPOINT', `not set, using default (${effectiveValue})`);
}

function checkPowerShellAvailable() {
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
    encoding: 'utf8'
  });

  if (result.status === 0) {
    return ok('PowerShell availability', `ok (${result.stdout.trim() || 'version unknown'})`);
  }

  return fail('PowerShell availability', (result.stderr || result.stdout || 'powershell.exe unavailable').trim());
}

async function checkBrokerHealth({ endpoint, apiKey }) {
  try {
    const response = await fetch(new URL('/health', endpoint), {
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
    });

    if (response.ok) {
      return ok('Broker health', `healthy at ${new URL('/health', endpoint).toString()}`);
    }

    const body = await response.text();
    return fail('Broker health', `HTTP ${response.status}: ${body.slice(0, 300)}`);
  } catch (error) {
    return fail('Broker health', `request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function checkAppActivation({ targetApp, windowTitle }) {
  const script = [
    `Start-Process '${escapePs(targetApp)}'`,
    'Start-Sleep -Seconds 2',
    '$shell = New-Object -ComObject WScript.Shell',
    `$ok = $shell.AppActivate('${escapePs(windowTitle)}')`,
    'if (-not $ok) { throw "AppActivate returned false." }',
    'Write-Output "activated"'
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', script], {
    encoding: 'utf8'
  });

  if (result.status === 0) {
    return ok('App activation', `${targetApp} / title ${windowTitle}`);
  }

  return fail('App activation', (result.stderr || result.stdout || 'activation failed').trim());
}

function printResults(checks, context) {
  console.log('Windows Preflight\n');
  console.log(`- target app: ${context.targetApp}`);
  console.log(`- window title: ${context.windowTitle}`);
  console.log(`- broker endpoint: ${context.brokerEndpoint}`);
  console.log(`- skip gateway checks: ${context.skipGateway ? 'yes' : 'no'}`);
  console.log(`- skip app activation: ${context.skipAppActivation ? 'yes' : 'no'}`);
  console.log('');

  for (const item of checks) {
    const prefix = item.ok ? '[PASS]' : '[FAIL]';
    console.log(`${prefix} ${item.name}: ${item.message}`);
  }

  const failed = checks.filter((item) => !item.ok).length;
  console.log('');
  if (failed === 0) {
    console.log('Preflight passed. You can run: npm run demo:any:notepad:real');
  } else {
    console.log(`Preflight failed with ${failed} item(s). Fix failures before running real mode.`);
  }
}

function ok(name, message) {
  return { ok: true, name, message };
}

function fail(name, message) {
  return { ok: false, name, message };
}

function escapePs(value) {
  return value.replace(/'/g, "''");
}

function readFlag(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function printHelp() {
  console.log([
    'Usage: node scripts/preflight-windows.mjs [options]',
    '',
    'Options:',
    '  --target-app <exe-or-uri>    Target app to launch (default: notepad.exe)',
    '  --window-title <title>        Window title used by AppActivate (default: Notepad)',
    '  --skip-gateway                Skip URL/KEY presence checks',
    '  --skip-app-activation         Skip launching and activating target app',
    '  -h, --help                    Show this help'
  ].join('\n'));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
