import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BrokerAction,
  DragAction,
  Provenance,
  ReplayTrace,
  RunMode,
  SafetyEvent,
  TransitionEnvelope,
  WINDOWS_FILE_SANDBOX_ROOT,
  appendJsonLine,
  applyActionToCanvas,
  canvasToPngBuffer,
  createId,
  createPaintCanvas,
  ensureTracePaths,
  writeJson,
  writeScreenshot,
  writeText
} from './traces.js';
import { verifyPaintStep } from './verifier.js';

const DEFAULT_REAL_BROKER_ENDPOINT = 'http://127.0.0.1:9477';
const DEFAULT_PAINT_TASK = 'In Microsoft Paint, make one visible diagonal mark using a bounded drag action.';
const AI_REQUEST_TIMEOUT_MS = 30000;
const BROKER_REQUEST_TIMEOUT_MS = 30000;
const BROKER_HEALTH_TIMEOUT_MS = 5000;

interface RunPaintDemoOptions {
  mode: RunMode;
  outputDir: string;
  task: string;
  aiBaseUrl?: string;
  aiKey?: string;
  brokerEndpoint?: string;
  brokerApiKey?: string;
  startBrokerIfNeeded: boolean;
}

interface PlannerDecision {
  source: 'ai' | 'fallback';
  transport?: 'responses' | 'chat.completions';
  summary: string;
  action: DragAction;
  requestArtifact?: string;
  responseArtifact?: string;
}

interface BrokerArtifact {
  kind?: string;
  mimeType?: string;
  ref?: string;
  contentBase64?: string;
}

interface BrokerResponseEnvelope {
  requestId: string;
  status: 'executed' | 'blocked' | 'failed';
  startedAt: string;
  finishedAt: string;
  artifacts: BrokerArtifact[];
  stateHandle?: {
    screenshotRef?: string;
    windowRef?: string;
    stateLabel?: string;
    evidenceRefs?: string[];
  };
  safetyEvent: SafetyEvent;
  error?: {
    code?: string;
    message?: string;
  };
}

interface BrokerBringUp {
  mode: RunMode;
  command: string;
  executed: boolean;
  note: string;
}

export interface PaintRunResult {
  mode: RunMode;
  outputDir: string;
  reportPath: string;
  replayTracePath: string;
  aiSource: PlannerDecision['source'];
  brokerBringUp: BrokerBringUp;
}

export async function runPaintDemo(options: RunPaintDemoOptions): Promise<PaintRunResult> {
  const tracePaths = await ensureTracePaths(options.outputDir);
  const sessionId = createId('paint-session');
  const traceId = createId('paint-trace');
  const brokerBringUp: BrokerBringUp =
    options.mode === 'real'
      ? await ensureRealBroker(options.brokerEndpoint ?? DEFAULT_REAL_BROKER_ENDPOINT, options.brokerApiKey, options.startBrokerIfNeeded)
      : {
          mode: 'mock',
          command: 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File windows-broker/scripts/start-desktop-broker.ps1',
          executed: false,
          note: 'Mock mode uses an in-process canvas instead of Windows actuation.'
        };

  const targetApp = 'mspaint.exe';
  const realBrokerEndpoint = options.brokerEndpoint ?? DEFAULT_REAL_BROKER_ENDPOINT;

  let beforeScreenshotBuffer: Buffer;
  let afterScreenshotBuffer: Buffer;
  let beforeScreenshotRef: string;
  let afterScreenshotRef: string;
  let actionResponse: BrokerResponseEnvelope;
  const notes: string[] = [brokerBringUp.note];

  if (options.mode === 'mock') {
    const initialCanvas = createPaintCanvas();
    beforeScreenshotBuffer = canvasToPngBuffer(initialCanvas);
    beforeScreenshotRef = await writeScreenshot(tracePaths, 'step-0-before.png', beforeScreenshotBuffer);

    const plannerDecision = await planPaintAction({
      task: options.task,
      screenshot: beforeScreenshotBuffer,
      outputDir: tracePaths.outputDir,
      aiBaseUrl: options.aiBaseUrl,
      aiKey: options.aiKey,
      requireLiveAi: false
    });

    const nextCanvas = applyActionToCanvas(initialCanvas, plannerDecision.action);
    afterScreenshotBuffer = canvasToPngBuffer(nextCanvas);
    afterScreenshotRef = await writeScreenshot(tracePaths, 'step-1-after.png', afterScreenshotBuffer);

    actionResponse = buildMockActionResponse(plannerDecision.action);
    await appendJsonLine(tracePaths.actionTracePath, {
      timestamp: new Date().toISOString(),
      requestId: actionResponse.requestId,
      status: actionResponse.status,
      source: plannerDecision.source,
      summary: plannerDecision.summary,
      action: plannerDecision.action,
      artifacts: actionResponse.artifacts,
      requestArtifact: plannerDecision.requestArtifact,
      responseArtifact: plannerDecision.responseArtifact
    });

    const verificationBundle = verifyPaintStep({
      beforeScreenshot: beforeScreenshotBuffer,
      afterScreenshot: afterScreenshotBuffer,
      action: plannerDecision.action,
      beforeRef: beforeScreenshotRef,
      afterRef: afterScreenshotRef
    });

    await appendJsonLine(tracePaths.verifierTracePath, verificationBundle.traceEntry);
    const transition = buildTransition({
      action: plannerDecision.action,
      beforeRef: beforeScreenshotRef,
      afterRef: afterScreenshotRef,
      verification: verificationBundle.verification,
      safetyEvent: verificationBundle.safetyEvent,
      provenance: plannerDecision.source === 'ai' ? 'computer_use' : 'hybrid',
      notes: plannerDecision.source === 'fallback' ? ['AI unavailable, fallback planner used for mock verification.'] : undefined
    });

    const replayTrace = buildReplayTrace({
      traceId,
      sessionId,
      screenshots: [beforeScreenshotRef, afterScreenshotRef],
      summaryReport: tracePaths.reportPath,
      transition,
      verificationPassed: verificationBundle.verification.status === 'passed',
      notes: plannerDecision.source === 'fallback' ? ['Mock broker used for validation; real broker pipeline is available via --mode real.'] : notes
    });

    await writeJson(tracePaths.replayTracePath, replayTrace);
    await writeStage2Report({
      reportPath: tracePaths.reportPath,
      mode: 'mock',
      task: options.task,
      aiSource: plannerDecision.source,
      aiTransport: plannerDecision.transport,
      brokerBringUp,
      replayTrace,
      notes
    });

    return {
      mode: 'mock',
      outputDir: tracePaths.outputDir,
      reportPath: tracePaths.reportPath,
      replayTracePath: tracePaths.replayTracePath,
      aiSource: plannerDecision.source,
      brokerBringUp
    };
  }

  await ensurePaintVisible();

  const beforeCapture = await captureRealScreenshot({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    targetApp,
    tracePaths,
    screenshotName: 'step-0-before.png'
  });
  beforeScreenshotBuffer = beforeCapture.buffer;
  beforeScreenshotRef = beforeCapture.relativePath;

  const plannerDecision = await planPaintAction({
    task: options.task,
    screenshot: beforeScreenshotBuffer,
    outputDir: tracePaths.outputDir,
    aiBaseUrl: options.aiBaseUrl,
    aiKey: options.aiKey,
    requireLiveAi: true
  });

  actionResponse = await invokeBrokerAction({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    action: plannerDecision.action,
    targetApp,
    requestId: createId('broker-action')
  });

  if (actionResponse.status !== 'executed') {
    throw new Error(`Broker action failed: ${actionResponse.error?.message ?? actionResponse.status}`);
  }

  await appendJsonLine(tracePaths.actionTracePath, {
    timestamp: new Date().toISOString(),
    requestId: actionResponse.requestId,
    status: actionResponse.status,
    source: plannerDecision.source,
    summary: plannerDecision.summary,
    action: plannerDecision.action,
    response: actionResponse,
    requestArtifact: plannerDecision.requestArtifact,
    responseArtifact: plannerDecision.responseArtifact
  });

  const afterCapture = await captureRealScreenshot({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    targetApp,
    tracePaths,
    screenshotName: 'step-1-after.png'
  });
  afterScreenshotBuffer = afterCapture.buffer;
  afterScreenshotRef = afterCapture.relativePath;

  const verificationBundle = verifyPaintStep({
    beforeScreenshot: beforeScreenshotBuffer,
    afterScreenshot: afterScreenshotBuffer,
    action: plannerDecision.action,
    beforeRef: beforeScreenshotRef,
    afterRef: afterScreenshotRef
  });

  await appendJsonLine(tracePaths.verifierTracePath, verificationBundle.traceEntry);
  const transition = buildTransition({
    action: plannerDecision.action,
    beforeRef: beforeScreenshotRef,
    afterRef: afterScreenshotRef,
    verification: verificationBundle.verification,
    safetyEvent: verificationBundle.safetyEvent,
    provenance: 'computer_use',
    notes: [
      `Broker endpoint: ${realBrokerEndpoint}`,
      `Windows sandbox root: ${WINDOWS_FILE_SANDBOX_ROOT}`
    ]
  });

  const replayTrace = buildReplayTrace({
    traceId,
    sessionId,
    screenshots: [beforeScreenshotRef, afterScreenshotRef],
    summaryReport: tracePaths.reportPath,
    transition,
    verificationPassed: verificationBundle.verification.status === 'passed',
    notes
  });

  await writeJson(tracePaths.replayTracePath, replayTrace);
  await writeStage2Report({
    reportPath: tracePaths.reportPath,
    mode: 'real',
    task: options.task,
    aiSource: plannerDecision.source,
    aiTransport: plannerDecision.transport,
    brokerBringUp,
    replayTrace,
    notes
  });

  return {
    mode: 'real',
    outputDir: tracePaths.outputDir,
    reportPath: tracePaths.reportPath,
    replayTracePath: tracePaths.replayTracePath,
    aiSource: plannerDecision.source,
    brokerBringUp
  };
}

async function planPaintAction(params: {
  task: string;
  screenshot: Buffer;
  outputDir: string;
  aiBaseUrl?: string;
  aiKey?: string;
  requireLiveAi: boolean;
}): Promise<PlannerDecision> {
  if (params.aiBaseUrl && params.aiKey) {
    try {
      return await callAiPlanner(params);
    } catch (error) {
      if (params.requireLiveAi) {
        throw error;
      }
    }
  }

  if (params.requireLiveAi) {
    throw new Error('Real pipeline requires URL and KEY for the GPT-5.4 planner.');
  }

  return {
    source: 'fallback',
    summary: 'Fallback planner selected a bounded drag across the Paint canvas.',
    action: createDefaultDragAction()
  };
}

async function callAiPlanner(params: {
  task: string;
  screenshot: Buffer;
  outputDir: string;
  aiBaseUrl?: string;
  aiKey?: string;
  requireLiveAi: boolean;
}): Promise<PlannerDecision> {
  const requestPath = path.join(params.outputDir, 'planner-request.json');
  const responsePath = path.join(params.outputDir, 'planner-response.json');
  const transport = await detectAiTransport(params.aiBaseUrl ?? '', params.aiKey ?? '');
  const endpoint =
    transport === 'chat.completions'
      ? resolveAiChatCompletionsEndpoint(params.aiBaseUrl ?? '')
      : resolveAiResponsesEndpoint(params.aiBaseUrl ?? '');

  const imageUrl = `data:image/png;base64,${params.screenshot.toString('base64')}`;
  const body =
    transport === 'chat.completions'
      ? {
          model: 'gpt-5.4',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: [
                    'You are planning one bounded action for Microsoft Paint.',
                    `Task: ${params.task}`,
                    'Return JSON only with this shape:',
                    '{"summary":"...","action":{"kind":"drag","from":{"x":number,"y":number},"to":{"x":number,"y":number},"target":"paint-canvas"}}',
                    'Assume Paint is open and visible. Choose one visible spatial drag inside the drawing canvas. Avoid file operations.'
                  ].join('\n')
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl
                  }
                }
              ]
            }
          ],
          temperature: 0
        }
      : {
          model: 'gpt-5.4',
          input: [
            {
              type: 'text',
              text: [
                'You are planning one bounded action for Microsoft Paint.',
                `Task: ${params.task}`,
                'Return JSON only with this shape:',
                '{"summary":"...","action":{"kind":"drag","from":{"x":number,"y":number},"to":{"x":number,"y":number},"target":"paint-canvas"}}',
                'Assume Paint is open and visible. Choose one visible spatial drag inside the drawing canvas. Avoid file operations.'
              ].join('\n')
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl
              }
            }
          ],
          reasoning_effort: 'none'
        };

  await writeJson(requestPath, body);

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.aiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }, AI_REQUEST_TIMEOUT_MS);

    const rawText = await response.text();
    await writeText(responsePath, rawText);

    try {
      if (!response.ok) {
        throw new Error(`AI planner request failed (${response.status}): ${rawText}`);
      }

      const payload = JSON.parse(rawText) as unknown;
      const apiErrorMessage = extractApiErrorMessage(payload);
      if (apiErrorMessage) {
        throw new Error(`AI planner service error: ${apiErrorMessage}`);
      }

      const outputText = extractOutputText(payload);
      const planned = parsePlannerJson(outputText);

      return {
        source: 'ai',
        transport,
        summary: planned.summary,
        action: planned.action,
        requestArtifact: path.basename(requestPath),
        responseArtifact: path.basename(responsePath)
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 3) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  throw lastError ?? new Error('AI planner failed without an explicit error.');
}

function parsePlannerJson(outputText: string): { summary: string; action: DragAction } {
  const start = outputText.indexOf('{');
  const end = outputText.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? outputText.slice(start, end + 1) : outputText;
  const parsed = JSON.parse(candidate) as unknown;

  if (!isRecord(parsed)) {
    throw new Error('AI planner returned a non-object payload.');
  }

  const action = parsed.action;
  if (!isRecord(action) || action.kind !== 'drag') {
    throw new Error('AI planner did not return a drag action.');
  }

  const from = parsePoint(action.from);
  const to = parsePoint(action.to);
  const target = typeof action.target === 'string' ? action.target : 'paint-canvas';
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'GPT-5.4 planned a bounded drag action.',
    action: {
      kind: 'drag',
      from,
      to,
      target
    }
  };
}

function extractOutputText(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error('AI payload is not an object.');
  }

  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0];
    if (isRecord(firstChoice) && isRecord(firstChoice.message) && typeof firstChoice.message.content === 'string') {
      return firstChoice.message.content;
    }
  }

  if (typeof payload.output_text === 'string' && payload.output_text.length > 0) {
    return payload.output_text;
  }

  const output = payload.output;
  if (Array.isArray(output)) {
    const collected: string[] = [];
    for (const item of output) {
      if (!isRecord(item)) {
        continue;
      }
      const content = item.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const contentItem of content) {
        if (isRecord(contentItem) && typeof contentItem.text === 'string') {
          collected.push(contentItem.text);
        }
      }
    }
    if (collected.length > 0) {
      return collected.join('\n');
    }
  }

  throw new Error('AI payload did not include output_text.');
}

function extractApiErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return undefined;
  }

  return typeof payload.error.message === 'string' ? payload.error.message : undefined;
}

async function ensureRealBroker(endpoint: string, brokerApiKey: string | undefined, startBrokerIfNeeded: boolean): Promise<BrokerBringUp> {
  const healthUrl = new URL('/health', endpoint).toString();
  if (await brokerHealthy(healthUrl, brokerApiKey)) {
    return {
      mode: 'real',
      command: `GET ${healthUrl}`,
      executed: false,
      note: 'Broker already healthy.'
    };
  }

  if (!startBrokerIfNeeded) {
    throw new Error(`Broker not healthy at ${healthUrl} and automatic start is disabled.`);
  }

  const port = Number.parseInt(new URL(endpoint).port || '9477', 10);
  const scriptPath = await resolveWindowsScriptPath(path.resolve('windows-broker', 'scripts', 'start-desktop-broker.ps1'));
  const args = ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Port', `${port}`];
  if (brokerApiKey) {
    args.push('-ApiKey', brokerApiKey);
  }

  const result = spawnSync('powershell.exe', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Failed to start broker: ${result.stderr || result.stdout}`);
  }

  const healthy = await waitForBrokerHealth(healthUrl, brokerApiKey);
  if (!healthy) {
    throw new Error(`Broker did not become healthy at ${healthUrl}.`);
  }

  return {
    mode: 'real',
    command: ['powershell.exe', ...args].join(' '),
    executed: true,
    note: 'Broker start was triggered from WSL through powershell.exe.'
  };
}

async function captureRealScreenshot(params: {
  endpoint: string;
  brokerApiKey?: string;
  sessionId: string;
  targetApp: string;
  tracePaths: Awaited<ReturnType<typeof ensureTracePaths>>;
  screenshotName: string;
}): Promise<{ buffer: Buffer; relativePath: string; response: BrokerResponseEnvelope }> {
  const response = await invokeBrokerAction({
    endpoint: params.endpoint,
    brokerApiKey: params.brokerApiKey,
    sessionId: params.sessionId,
    targetApp: params.targetApp,
    requestId: createId('broker-screenshot'),
    action: {
      kind: 'screenshot',
      scope: 'window',
      target: params.targetApp
    }
  });

  if (response.status !== 'executed') {
    throw new Error(`Screenshot capture failed: ${response.error?.message ?? response.status}`);
  }

  const artifact = response.artifacts.find((entry) => entry.kind === 'screenshot' && typeof entry.contentBase64 === 'string');
  if (!artifact?.contentBase64) {
    throw new Error('Broker screenshot response did not include a base64 screenshot artifact.');
  }

  const buffer = Buffer.from(artifact.contentBase64, 'base64');
  const relativePath = await writeScreenshot(params.tracePaths, params.screenshotName, buffer);
  return { buffer, relativePath, response };
}

async function invokeBrokerAction(params: {
  endpoint: string;
  brokerApiKey?: string;
  sessionId: string;
  requestId: string;
  targetApp: string;
  action: BrokerAction;
}): Promise<BrokerResponseEnvelope> {
  const response = await fetchWithTimeout(new URL('/v1/action', params.endpoint), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(params.brokerApiKey ? { Authorization: `Bearer ${params.brokerApiKey}` } : {})
    },
    body: JSON.stringify({
      requestId: params.requestId,
      sessionId: params.sessionId,
      action: params.action,
      policyContext: {
        allowedRoots: [WINDOWS_FILE_SANDBOX_ROOT],
        blockedCapabilities: ['arbitrary_shell', 'registry_mutation', 'process_kill'],
        operator: 'stage2-paint-demo',
        requiresHumanReview: false
      },
      expectedState: {
        targetApp: params.targetApp
      }
    })
  }, BROKER_REQUEST_TIMEOUT_MS);

  const payloadText = await response.text();
  if (!response.ok) {
    throw new Error(`Broker request failed (${response.status}): ${payloadText}`);
  }

  return JSON.parse(payloadText) as BrokerResponseEnvelope;
}

function buildMockActionResponse(_action: BrokerAction): BrokerResponseEnvelope {
  const now = new Date().toISOString();
  return {
    requestId: createId('mock-action'),
    status: 'executed',
    startedAt: now,
    finishedAt: now,
    artifacts: [],
    safetyEvent: {
      decision: 'allowed',
      reason: 'Mock broker applies the bounded action in-process.',
      policyRefs: ['mock-broker']
    },
    stateHandle: {
      stateLabel: 'mock-after-action',
      screenshotRef: 'screenshots/step-1-after.png',
      evidenceRefs: ['screenshots/step-0-before.png', 'screenshots/step-1-after.png']
    }
  };
}

function buildTransition(params: {
  action: BrokerAction;
  beforeRef: string;
  afterRef: string;
  verification: TransitionEnvelope['verification'];
  safetyEvent: SafetyEvent;
  provenance: Provenance;
  notes?: string[];
}): TransitionEnvelope {
  return {
    transitionId: createId('transition'),
    timestamp: new Date().toISOString(),
    provenance: params.provenance,
    action: params.action,
    before: {
      screenshotRef: params.beforeRef,
      windowRef: 'mspaint.exe',
      stateLabel: 'before-action',
      evidenceRefs: [params.beforeRef]
    },
    after: {
      screenshotRef: params.afterRef,
      windowRef: 'mspaint.exe',
      stateLabel: 'after-action',
      evidenceRefs: [params.afterRef]
    },
    verification: params.verification,
    safetyEvent: params.safetyEvent,
    notes: params.notes
  };
}

function buildReplayTrace(params: {
  traceId: string;
  sessionId: string;
  screenshots: string[];
  summaryReport: string;
  transition: TransitionEnvelope;
  verificationPassed: boolean;
  notes: string[];
}): ReplayTrace {
  return {
    traceId: params.traceId,
    sessionId: params.sessionId,
    createdAt: new Date().toISOString(),
    target: {
      app: 'mspaint.exe',
      environment: 'windows-desktop',
      operatorPlane: 'wsl'
    },
    artifacts: {
      screenshots: params.screenshots,
      actionTrace: 'action-trace.jsonl',
      verifierTrace: 'verifier-trace.jsonl',
      summaryReport: params.summaryReport
    },
    steps: [params.transition],
    summary: {
      status: params.verificationPassed ? 'completed' : 'failed',
      stepCount: 1,
      verificationPassed: params.verificationPassed,
      notes: params.notes
    },
    safetyEvents: [
      {
        decision: params.transition.safetyEvent.decision,
        reason: params.transition.safetyEvent.reason,
        transitionId: params.transition.transitionId
      }
    ]
  };
}

async function writeStage2Report(params: {
  reportPath: string;
  mode: RunMode;
  task: string;
  aiSource: PlannerDecision['source'];
  aiTransport?: PlannerDecision['transport'];
  brokerBringUp: BrokerBringUp;
  replayTrace: ReplayTrace;
  notes: string[];
}): Promise<void> {
  const screenshots = params.replayTrace.artifacts.screenshots.map((entry) => `  - ${entry}`).join('\n');
  const notes = params.notes.length > 0 ? params.notes.map((note) => `- ${note}`).join('\n') : '- No additional notes.';

  const finalContent = [
    '# Stage 2 Report: Paint-first Computer Use Demo',
    '',
    '## Goal',
    '',
    'Demonstrate a Paint-first computer-use loop that captures screenshots, plans an action with GPT-5.4-compatible input, executes the action through a bounded broker path, and persists replay artifacts.',
    '',
    '## Run summary',
    '',
    `- Mode: ${params.mode}`,
    `- Task: ${params.task}`,
    `- AI source: ${params.aiSource}`,
    `- AI transport: ${params.aiTransport ?? 'fallback'}`,
    `- Broker bring-up command: ${params.brokerBringUp.command}`,
    `- Broker bring-up note: ${params.brokerBringUp.note}`,
    '',
    '## Replay artifacts',
    '',
    `- Summary report: ${params.reportPath}`,
    '- Screenshots:',
    screenshots,
    `- Action trace: ${params.replayTrace.artifacts.actionTrace}`,
    `- Verifier trace: ${params.replayTrace.artifacts.verifierTrace}`,
    '',
    '## Verification status',
    '',
    `- Replay status: ${params.replayTrace.summary.status}`,
    `- Verification passed: ${params.replayTrace.summary.verificationPassed ? 'yes' : 'no'}`,
    '',
    '## Notes',
    '',
    notes,
    '',
    '## Real pipeline reminder',
    '',
    'Mock mode is only for local validation. The real pipeline is the `--mode real` path, which uses:',
    '',
    '- `URL` / `KEY` for the GPT-5.4-compatible API gateway,',
    '- automatic transport selection between `/v1/responses` and `/v1/chat/completions` based on gateway capabilities,',
    '- `WINDOWS_BROKER_ENDPOINT` for the Windows broker,',
    '- and WSL-triggered `powershell.exe` broker bring-up.',
    ''
  ].join('\n');

  await writeText(params.reportPath, finalContent);
}

function createDefaultDragAction(): DragAction {
  return {
    kind: 'drag',
    from: { x: 24, y: 28 },
    to: { x: 70, y: 50 },
    target: 'paint-canvas'
  };
}

function resolveAiResponsesEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.pathname.endsWith('/responses')) {
    return url.toString();
  }
  if (url.pathname.endsWith('/v1') || url.pathname.endsWith('/v1/')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/responses`;
    return url.toString();
  }
  url.pathname = path.posix.join(url.pathname, 'v1', 'responses');
  return url.toString();
}

function resolveAiChatCompletionsEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.pathname.endsWith('/chat/completions')) {
    return url.toString();
  }
  if (url.pathname.endsWith('/v1') || url.pathname.endsWith('/v1/')) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
    return url.toString();
  }
  url.pathname = path.posix.join(url.pathname, 'v1', 'chat', 'completions');
  return url.toString();
}

async function detectAiTransport(baseUrl: string, aiKey: string): Promise<'responses' | 'chat.completions'> {
  const url = new URL(baseUrl);
  const root = `${url.protocol}//${url.host}/`;

  try {
    const response = await fetchWithTimeout(root, {
      headers: {
        Authorization: `Bearer ${aiKey}`
      }
    }, BROKER_HEALTH_TIMEOUT_MS);

    if (!response.ok) {
      return 'responses';
    }

    const text = await response.text();
    if (text.includes('/v1/chat/completions') && !text.includes('/v1/responses')) {
      return 'chat.completions';
    }
  } catch {
    return 'responses';
  }

  return 'responses';
}

async function ensurePaintVisible(): Promise<void> {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      "Start-Process mspaint.exe; Start-Sleep -Seconds 2; $shell = New-Object -ComObject WScript.Shell; $null = $shell.AppActivate('Paint')"
    ],
    {
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to launch or activate Paint: ${result.stderr || result.stdout}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function resolveWindowsScriptPath(scriptPath: string): Promise<string> {
  const result = spawnSync('wslpath', ['-w', scriptPath], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout.trim().length > 0) {
    return result.stdout.trim();
  }
  return scriptPath;
}

async function brokerHealthy(healthUrl: string, brokerApiKey?: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(healthUrl, {
      headers: brokerApiKey ? { Authorization: `Bearer ${brokerApiKey}` } : undefined
    }, BROKER_HEALTH_TIMEOUT_MS);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForBrokerHealth(healthUrl: string, brokerApiKey?: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await brokerHealthy(healthUrl, brokerApiKey)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function parsePoint(value: unknown): { x: number; y: number } {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    throw new Error('Planner point payload is invalid.');
  }
  return { x: value.x, y: value.y };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export { DEFAULT_PAINT_TASK };
