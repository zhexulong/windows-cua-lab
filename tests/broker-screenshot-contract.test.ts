import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { ensureTracePaths } from '../apps/runner/src/traces.ts';

const execFileAsync = promisify(execFile);

type LoopScreenshotExports = {
  captureRealScreenshot?: (params: {
    endpoint: string;
    brokerApiKey?: string;
    sessionId: string;
    targetApp: string;
    tracePaths: Awaited<ReturnType<typeof ensureTracePaths>>;
    screenshotName: string;
  }) => Promise<{
    buffer: Buffer;
    relativePath: string;
    response: {
      status: 'executed' | 'blocked' | 'failed';
      artifacts: Array<{
        kind?: string;
        ref?: string;
        contentBase64?: string;
      }>;
    };
  }>;
  buildTopLevelRunnerFailureReport?: (params: {
    error: unknown;
    actionKind?: string | null;
  }) => Record<string, unknown> | null;
};

async function loadLoopExports(): Promise<LoopScreenshotExports> {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-broker-screenshot-'));
  const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.json', '--outDir', outDir], {
    cwd: repoRoot,
    stdio: 'pipe'
  });

  const loopModule = await import(pathToFileURL(path.join(outDir, 'apps/runner/src/loop.js')).href);
  return loopModule as LoopScreenshotExports;
}

async function withStubbedFetch<T>(fetchImpl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createBrokerScreenshotResponse(artifact: {
  kind?: string;
  ref?: string;
  contentBase64?: string;
}) {
  return {
    requestId: 'broker-screenshot-123',
    status: 'executed' as const,
    startedAt: '2026-04-26T00:00:00.000Z',
    finishedAt: '2026-04-26T00:00:00.100Z',
    artifacts: [artifact],
    safetyEvent: {
      decision: 'allowed' as const
    }
  };
}

function normalizeWindowsPathForRuntime(inputPath: string, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'win32') {
    return path.win32.normalize(inputPath);
  }

  return null;
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replaceAll("'", "''");
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8'
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveWindowsPath(posixPath: string): Promise<string> {
  const nativePath = normalizeWindowsPathForRuntime(posixPath);
  if (nativePath) {
    return nativePath;
  }

  const { stdout } = await execFileAsync('wslpath', ['-w', posixPath], {
    encoding: 'utf8'
  });
  return stdout.trim();
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a loopback port for the desktop broker test.')));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
}

async function waitForBrokerHealth(endpoint: string, timeoutMs: number, failureContext?: () => Promise<string>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/health', endpoint));
      if (response.ok) {
        return;
      }

      lastError = new Error(`Health probe returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  const extraContext = failureContext ? await failureContext() : '';
  throw new Error([
    `Timed out waiting for desktop broker health at ${endpoint}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    extraContext
  ].filter(Boolean).join('\n'));
}

async function startIsolatedDesktopBroker(params: {
  port: number;
  repoRoot: string;
  scriptRootPath?: string;
}) {
  const projectPath = await resolveWindowsPath(
    path.join(params.repoRoot, 'windows-broker', 'src', 'DesktopBroker', 'DesktopBroker.csproj')
  );
  const buildOutputDir = await resolveWindowsPath(
    path.join(params.repoRoot, 'windows-broker', 'src', 'DesktopBroker', 'bin', 'Debug', 'net8.0-windows')
  );
  const scriptRoot = await resolveWindowsPath(params.scriptRootPath ?? path.join(params.repoRoot, 'windows-broker', 'scripts'));
  const artifactRoot = `C:\\Windows\\Temp\\windows-cua-lab-broker-contract-${Date.now()}-${params.port}`;
  const stdoutLog = `${artifactRoot}\\desktop-broker.stdout.log`;
  const stderrLog = `${artifactRoot}\\desktop-broker.stderr.log`;
  const startScript = [
    `$project = '${escapePowerShellSingleQuoted(projectPath)}'`,
    `$buildOutputDir = '${escapePowerShellSingleQuoted(buildOutputDir)}'`,
    `$scriptRoot = '${escapePowerShellSingleQuoted(scriptRoot)}'`,
    `$artifactRoot = '${escapePowerShellSingleQuoted(artifactRoot)}'`,
    '$brokerExe = Join-Path $buildOutputDir "DesktopBroker.exe"',
    '$stdoutLog = Join-Path $artifactRoot "desktop-broker.stdout.log"',
    '$stderrLog = Join-Path $artifactRoot "desktop-broker.stderr.log"',
    'dotnet build $project | Out-Null',
    'New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null',
    '$arguments = @("--host", "127.0.0.1", "--port", "' + `${params.port}` + '", "--script-root", $scriptRoot, "--artifact-root", $artifactRoot)',
    '$process = Start-Process -FilePath $brokerExe -WorkingDirectory $buildOutputDir -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog',
    '$process.Id'
  ].join('; ');

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-Command', startScript],
    {
      encoding: 'utf8'
    }
  );

  const pid = Number.parseInt(stdout.trim(), 10);
  if (!Number.isFinite(pid)) {
    throw new Error(`Desktop broker test did not receive a valid PID from PowerShell startup: ${stdout.trim()}`);
  }

  return {
    pid,
    endpoint: `http://127.0.0.1:${params.port}`,
    artifactRoot,
    stdoutLog,
    stderrLog
  };
}

async function stopIsolatedDesktopBroker(pid: number): Promise<void> {
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`],
      {
        encoding: 'utf8'
      }
    );
  } catch {
    // best-effort cleanup for a Windows-only behavior probe
  }
}

async function readBrokerDiagnostics(broker: {
  artifactRoot: string;
  stdoutLog: string;
  stderrLog: string;
}): Promise<string> {
  const diagnostics = [];
  try {
    const stdout = await readFile(broker.stdoutLog, 'utf8');
    if (stdout.trim()) {
      diagnostics.push(`STDOUT:\n${stdout.trim()}`);
    }
  } catch {
    // ignore missing stdout on failed startup
  }

  try {
    const stderr = await readFile(broker.stderrLog, 'utf8');
    if (stderr.trim()) {
      diagnostics.push(`STDERR:\n${stderr.trim()}`);
    }
  } catch {
    // ignore missing stderr on failed startup
  }

  diagnostics.push(`artifactRoot=${broker.artifactRoot}`);
  diagnostics.push(`stdoutLog=${broker.stdoutLog}`);
  diagnostics.push(`stderrLog=${broker.stderrLog}`);
  return diagnostics.join('\n');
}

async function postBrokerAction(params: {
  endpoint: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
}): Promise<{ statusCode: number; body: string }> {
  const url = new URL('/v1/action', params.endpoint);
  const body = JSON.stringify(params.payload);

  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    request.setTimeout(params.timeoutMs, () => {
      request.destroy(new Error(`Timed out waiting ${params.timeoutMs}ms for broker screenshot action response.`));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

test('captureRealScreenshot rejects ref-only screenshot responses as broker screenshot contract violations', async () => {
  const loop = await loadLoopExports();
  assert.equal(typeof loop.captureRealScreenshot, 'function');
  if (!loop.captureRealScreenshot) {
    return;
  }

  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-screenshot-contract-fail-'));
  const tracePaths = await ensureTracePaths(outputDir);

  await withStubbedFetch(
    async () =>
      new Response(
        JSON.stringify(
          createBrokerScreenshotResponse({
            kind: 'screenshot',
            ref: 'openreverse://session/demo/cua/snapshots/shot-0001'
          })
        ),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      ),
    async () => {
      await assert.rejects(
        loop.captureRealScreenshot({
          endpoint: 'http://127.0.0.1:10578',
          sessionId: 'session-123',
          targetApp: 'notepad.exe',
          tracePaths,
          screenshotName: 'step-0-before.png'
        }),
        (error) => {
          assert.equal((error as { code?: string }).code, 'broker_screenshot_contract_violation');
          assert.equal((error as { reasonCode?: string }).reasonCode, 'broker_screenshot_missing_base64');
          assert.match(String((error as { message?: string }).message), /contentbase64/i);
          return true;
        }
      );
    }
  );
});

test('normalizeWindowsPathForRuntime keeps native Windows repo paths unchanged on win32 runners', () => {
  assert.equal(
    normalizeWindowsPathForRuntime('C:\\repo\\windows-cua-lab', 'win32'),
    'C:\\repo\\windows-cua-lab'
  );
  assert.equal(
    normalizeWindowsPathForRuntime('/home/prosumer/agent/reverse/windows-cua-lab', 'linux'),
    null
  );
});

test('captureRealScreenshot accepts ref plus contentBase64 and writes the screenshot artifact', async () => {
  const loop = await loadLoopExports();
  assert.equal(typeof loop.captureRealScreenshot, 'function');
  if (!loop.captureRealScreenshot) {
    return;
  }

  const screenshotBuffer = Buffer.from('runner-screenshot');
  const outputDir = mkdtempSync(path.join(os.tmpdir(), 'windows-cua-lab-screenshot-contract-pass-'));
  const tracePaths = await ensureTracePaths(outputDir);

  const result = await withStubbedFetch(
    async () =>
      new Response(
        JSON.stringify(
          createBrokerScreenshotResponse({
            kind: 'screenshot',
            ref: 'openreverse://session/demo/cua/snapshots/shot-0002',
            contentBase64: screenshotBuffer.toString('base64')
          })
        ),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      ),
    () =>
      loop.captureRealScreenshot!({
        endpoint: 'http://127.0.0.1:10578',
        sessionId: 'session-123',
        targetApp: 'notepad.exe',
        tracePaths,
        screenshotName: 'step-0-before.png'
      })
  );

  assert.deepEqual(result.buffer, screenshotBuffer);
  assert.equal(result.relativePath, path.join('screenshots', 'step-0-before.png'));
  assert.equal(result.response.artifacts[0]?.ref, 'openreverse://session/demo/cua/snapshots/shot-0002');
  const writtenScreenshot = await readFile(path.join(outputDir, result.relativePath));
  assert.deepEqual(writtenScreenshot, screenshotBuffer);
});

test('top-level runner failure report preserves broker screenshot contract diagnosis fields', async () => {
  const loop = await loadLoopExports();
  assert.equal(typeof loop.buildTopLevelRunnerFailureReport, 'function');
  if (!loop.buildTopLevelRunnerFailureReport) {
    return;
  }

  const error = new Error('Broker screenshot response did not include screenshot contentBase64.') as Error & {
    code?: string;
    reasonCode?: string;
  };
  error.code = 'broker_screenshot_contract_violation';
  error.reasonCode = 'broker_screenshot_missing_base64';

  const report = loop.buildTopLevelRunnerFailureReport({
    error,
    actionKind: 'click'
  });

  assert.deepEqual(report, {
    outcome: 'fail',
    target_resolved: null,
    target_activated: null,
    action_executed: false,
    action_kind: 'click',
    goal_summary: 'Broker screenshot response did not include screenshot contentBase64.',
    goal_state: 'inconclusive',
    target_activation_reason: null,
    foreground_before: null,
    foreground_after: null,
    actual_process_name: null,
    actual_window_title: null,
    diagnosis_code: 'broker_screenshot_contract_violation',
    diagnosis_summary: 'Broker screenshot response did not include screenshot contentBase64.',
    verification_state: 'verification_inconclusive',
    verification_error_code: 'broker_screenshot_contract_violation',
    host_refused: false,
    contract_reason_code: 'broker_screenshot_missing_base64'
  });
});

test('windows broker screenshot producer writes inline contentBase64 on the active C# path', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const handlerSource = readFileSync(
    path.join(repoRoot, 'windows-broker', 'src', 'DesktopBroker', 'BrokerRequestHandler.cs'),
    'utf8'
  );

  assert.match(handlerSource, /Kind = "screenshot"/);
  assert.match(handlerSource, /Ref = screenshot\.Ref/);
  assert.match(handlerSource, /ContentBase64 = screenshot\.Base64/);
});

test('windows broker screenshot endpoint emits non-empty contentBase64 on the active producer path', { timeout: 120000 }, async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Runs as part of the default Windows broker CI surface only.')
    return;
  }

  const repoRoot = path.resolve(import.meta.dirname, '..');
  const port = await allocateLoopbackPort();
  const broker = await startIsolatedDesktopBroker({ port, repoRoot });
  t.after(async () => {
    await stopIsolatedDesktopBroker(broker.pid);
  });

  await waitForBrokerHealth(broker.endpoint, 30000, () => readBrokerDiagnostics(broker));

  let response;
  try {
    response = await postBrokerAction({
      endpoint: broker.endpoint,
      timeoutMs: 20000,
      payload: {
        requestId: 'test-screenshot-live-producer',
        sessionId: 'broker-test-live-producer',
        action: {
          kind: 'screenshot',
          scope: 'desktop',
          target: ''
        },
        policyContext: {
          allowedRoots: ['E:\\projects\\desktop-discovery-lab-temp'],
          blockedCapabilities: ['arbitrary_shell', 'registry_mutation', 'process_kill'],
          operator: 'broker-test',
          requiresHumanReview: false
        },
        expectedState: {
          targetApp: ''
        }
      }
    });
  } catch (error) {
    throw new Error([
      `Desktop broker screenshot action did not complete cleanly: ${error instanceof Error ? error.message : String(error)}`,
      await readBrokerDiagnostics(broker)
    ].join('\n'));
  }

  assert.equal(response.statusCode, 200, `Expected broker screenshot action to succeed, got HTTP ${response.statusCode}.\n${response.body}`);
  const payload = JSON.parse(response.body) as {
    status?: string;
    artifacts?: Array<{
      kind?: string;
      ref?: string;
      contentBase64?: string;
    }>;
  };
  assert.equal(payload.status, 'executed');
  assert.equal(payload.artifacts?.[0]?.kind, 'screenshot');
  assert.match(payload.artifacts?.[0]?.ref ?? '', /screenshot/i);
  assert.ok(payload.artifacts?.[0]?.contentBase64, 'Expected live broker screenshot artifact to include contentBase64.');
  assert.ok(Buffer.from(payload.artifacts?.[0]?.contentBase64 ?? '', 'base64').length > 0, 'Expected live broker screenshot contentBase64 to decode to non-empty bytes.');
});
