import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  BrokerAction,
  DragAction,
  type ForegroundWindowSnapshot,
  Provenance,
  ReplayTrace,
  RunMode,
  SafetyEvent,
  TransitionEnvelope,
  WINDOWS_FILE_SANDBOX_ROOT,
  appendJsonLine,
  applyActionToCanvas,
  canvasToPngBuffer,
  createCalculatorCanvas,
  createId,
  createPaintCanvas,
  ensureTracePaths,
  writeJson,
  writeScreenshot,
  writeText
} from './traces.js';
import {
  type GenericPlannerContext,
  type StructuredRegionHint,
  type StructuredRunnerOperation,
  type StructuredVisualTarget,
  type StructuredWaitCondition,
  validateGenericPlannerAction
} from './generic-planner-constraints.js';
import {
  buildGenericPlannerInstruction,
  buildGenericVerifierInstruction,
  resolveGenericPlannerObjectiveText,
} from './generic-planner-instruction.js';
import {
  createBrokerScreenshotContractError,
  extractComputerCallFromPayload,
  validateBrokerScreenshotResponse
} from './openai-computer-use-contract.js';
import {
  buildSettleSchedule,
  selectBestEvidenceSample,
  shouldInvokeSemanticJudge,
  type SemanticSettleState,
  type SettleSample
} from './settle-verifier.js';
import { measureVisualDelta, type VerificationTraceEntry, verifyCalculatorStep, verifyPaintStep } from './verifier.js';
export { extractComputerCallFromPayload } from './openai-computer-use-contract.js';

const DEFAULT_REAL_BROKER_ENDPOINT = 'http://127.0.0.1:10578';
const DEFAULT_PAINT_TASK = 'In Microsoft Paint, make one visible diagonal mark using a bounded drag action.';
const DEFAULT_CALCULATOR_TASK = 'In Windows Calculator, compute 12 + 34 and show the final result.';
const DEFAULT_GENERIC_TASK = 'In the target Windows app, perform one safe, visible UI action that advances the task.';
const AI_REQUEST_TIMEOUT_MS = 30000;
const VERIFIER_AI_REQUEST_TIMEOUT_MS = 60000;
const BROKER_REQUEST_TIMEOUT_MS = 30000;
const BROKER_HEALTH_TIMEOUT_MS = 5000;
const DEBUG_HARNESS_ENV = 'FULL_APP_VERIFICATION_DEBUG';

interface RunPaintDemoOptions {
  mode: RunMode;
  outputDir: string;
  task: string;
  aiBaseUrl?: string;
  aiKey?: string;
  brokerEndpoint?: string;
  brokerApiKey?: string;
  startBrokerIfNeeded: boolean;
  reportPath?: string;
  targetApp?: string;
}

interface RunCalculatorDemoOptions extends RunPaintDemoOptions {
  expression: string;
  expectedResult: string;
}

interface RunGenericDemoOptions extends Omit<RunPaintDemoOptions, 'task'> {
  task?: string;
  targetApp: string;
  launchCommand?: string;
  windowTitle?: string;
  plannerContext?: GenericPlannerContext;
}

interface PlannerDecision {
  source: 'ai' | 'fallback' | 'structured';
  transport?: 'responses' | 'chat.completions';
  summary: string;
  action: BrokerAction;
  plannerAttemptCount?: number;
  validation?: {
    accepted: boolean;
    rejectionReason?: string;
  };
  requestArtifact?: string;
  responseArtifact?: string;
}

type PlannerAttemptArtifact = {
  attempt: number;
  status: 'success' | 'failure';
  transport?: AiTransport;
  planner_action_kind?: string;
  request_artifact?: string;
  response_artifact?: string;
  failure_kind?: PlannerFailureKind;
  retryable?: boolean;
  message?: string;
  rejection_reason?: string;
};

type ActionDecisionArtifact = {
  planner_source: 'ai' | 'fallback' | 'structured';
  planner_attempt_count: number;
  planner_action: BrokerAction;
  validation: {
    accepted: boolean;
    rejection_reason?: string;
  };
  fallback_used: boolean;
  executed_action: BrokerAction;
};

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
    targetResolved?: boolean;
    targetActivated?: boolean;
    actualProcessName?: string;
    actualWindowTitle?: string;
    actualPid?: string;
    actualHwnd?: string;
    foregroundBefore?: {
      hwnd?: string;
      pid?: string;
      processName?: string;
      windowTitle?: string;
    };
    foregroundAfter?: {
      hwnd?: string;
      pid?: string;
      processName?: string;
      windowTitle?: string;
    };
  };
  safetyEvent: SafetyEvent;
  error?: {
    code?: string;
    message?: string;
  };
}

interface RunReportForegroundWindowSnapshot {
  hwnd?: string;
  pid?: string;
  process_name?: string;
  window_title?: string;
}

interface GenericRunReport {
  outcome: 'pass' | 'fail';
  target_resolved: boolean | null;
  target_activated: boolean | null;
  action_executed: boolean;
  action_kind: BrokerAction['kind'] | null;
  goal_summary: string | null;
  goal_state?: 'achieved' | 'not_achieved' | 'inconclusive' | 'refused' | null;
  target_activation_reason: string | null;
  foreground_before: RunReportForegroundWindowSnapshot | null;
  foreground_after: RunReportForegroundWindowSnapshot | null;
  actual_process_name: string | null;
  actual_window_title: string | null;
  diagnosis_code?: string | null;
  diagnosis_summary?: string | null;
  verification_state?: 'verified_true' | 'verified_false' | 'verification_inconclusive' | 'not_checked' | null;
  verification_error_code?: string | null;
  host_refused?: boolean | null;
  contract_reason_code?: string | null;
}

interface BrokerBringUp {
  mode: RunMode;
  command: string;
  executed: boolean;
  note: string;
}

interface GenericSemanticClassification {
  semanticState: SemanticSettleState;
  summary: string;
  classificationKind:
    | 'semantic_success_like'
    | 'semantic_failure_like'
    | 'semantic_loading'
    | 'semantic_ambiguous'
    | 'verifier_empty_response'
    | 'verifier_parse_failure'
    | 'verifier_timeout'
    | 'verifier_shape_mismatch';
}

interface GenericSettleVerificationBundle {
  verification: TransitionEnvelope['verification'];
  traceEntries: VerificationTraceEntry[];
  safetyEvent: SafetyEvent;
  screenshotRefs: string[];
  finalAfterRef: string;
}

export type AiTransport = 'responses' | 'chat.completions';

function isDebugHarnessEnabled(): boolean {
  const raw = process.env[DEBUG_HARNESS_ENV]?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

async function writeDebugJsonIfEnabled(outputDir: string, fileName: string, value: unknown): Promise<void> {
  if (!isDebugHarnessEnabled()) {
    return;
  }

  await writeJson(path.join(outputDir, fileName), value);
}

export type PlannerFailureKind =
  | 'planner-timeout'
  | 'planner-http-failure'
  | 'planner-empty-response'
  | 'planner-shape-mismatch'
  | 'planner-invalid-json'
  | 'planner-action-rejected';

export type PlannerFailure = Error & {
  kind: PlannerFailureKind;
  retryable: boolean;
  cause?: unknown;
};

export type AiCallFailureKind =
  | 'timeout'
  | 'http_error'
  | 'service_error'
  | 'shape_mismatch'
  | 'empty_completion'
  | 'invalid_json';

type AiCallFailureResult = {
  ok: false;
  transport?: AiTransport;
  failureKind: AiCallFailureKind;
  message: string;
  rawText?: string;
  payload?: unknown;
  status?: number;
};

type ParsedAiPayloadResult =
  | {
      ok: true;
      transport: AiTransport;
      rawText: string;
      payload: unknown;
    }
  | AiCallFailureResult;

export type ExtractedTextResult =
  | { ok: true; text: string }
  | { ok: false; failureKind: 'empty_completion' | 'shape_mismatch'; message: string };

type AiTextExtractionResult =
  | {
      ok: true;
      transport: AiTransport;
      rawText: string;
      payload: unknown;
      text: string;
    }
  | AiCallFailureResult;

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
  const reportPath = options.reportPath ?? path.join('docs', 'reports', 'stage-2-paint-demo.md');
  const brokerBringUp: BrokerBringUp =
    options.mode === 'real'
      ? await ensureRealBroker(options.brokerEndpoint ?? DEFAULT_REAL_BROKER_ENDPOINT, options.brokerApiKey, options.startBrokerIfNeeded)
      : {
          mode: 'mock',
          command: 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File windows-broker/scripts/start-desktop-broker.ps1',
          executed: false,
          note: 'Mock mode uses an in-process canvas instead of Windows actuation.'
        };

  const targetApp = options.targetApp ?? 'mspaint.exe';
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
      targetApp,
      notes: plannerDecision.source === 'fallback' ? ['AI unavailable, fallback planner used for mock verification.'] : undefined
    });

    const replayTrace = buildReplayTrace({
      traceId,
      sessionId,
      targetApp,
      screenshots: [beforeScreenshotRef, afterScreenshotRef],
      summaryReport: reportPath,
      transition,
      verificationPassed: verificationBundle.verification.status === 'passed',
      notes: plannerDecision.source === 'fallback' ? ['Mock broker used for validation; real broker pipeline is available via --mode real.'] : notes
    });

    await writeJson(tracePaths.replayTracePath, replayTrace);
    await writeStage2Report({
      reportPath,
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
      reportPath,
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
    targetApp,
    notes: [
      `Broker endpoint: ${realBrokerEndpoint}`,
      `Windows sandbox root: ${WINDOWS_FILE_SANDBOX_ROOT}`
    ]
  });

  const replayTrace = buildReplayTrace({
    traceId,
    sessionId,
    targetApp,
    screenshots: [beforeScreenshotRef, afterScreenshotRef],
    summaryReport: reportPath,
    transition,
    verificationPassed: verificationBundle.verification.status === 'passed',
    notes
  });

  await writeJson(tracePaths.replayTracePath, replayTrace);
  await writeStage2Report({
    reportPath,
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
    reportPath,
    replayTracePath: tracePaths.replayTracePath,
    aiSource: plannerDecision.source,
    brokerBringUp
  };
}

export async function runCalculatorDemo(options: RunCalculatorDemoOptions): Promise<PaintRunResult> {
  const tracePaths = await ensureTracePaths(options.outputDir);
  const sessionId = createId('calculator-session');
  const traceId = createId('calculator-trace');
  const reportPath = options.reportPath ?? path.join('docs', 'reports', 'stage-3-calculator-validation.md');
  const targetApp = options.targetApp ?? 'CalculatorApp.exe';
  const realBrokerEndpoint = options.brokerEndpoint ?? DEFAULT_REAL_BROKER_ENDPOINT;
  const brokerBringUp: BrokerBringUp =
    options.mode === 'real'
      ? await ensureRealBroker(realBrokerEndpoint, options.brokerApiKey, options.startBrokerIfNeeded)
      : {
          mode: 'mock',
          command: 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File windows-broker/scripts/start-desktop-broker.ps1',
          executed: false,
          note: 'Mock mode uses an in-process calculator canvas instead of Windows actuation.'
        };

  const notes: string[] = [brokerBringUp.note];
  const calculatorAction: BrokerAction = {
    kind: 'type',
    text: options.expression,
    target: 'calculator-input'
  };
  const sequence = parseCalculatorExpression(options.expression);

  if (options.mode === 'mock') {
    const beforeCanvas = createCalculatorCanvas('0');
    const beforeScreenshotBuffer = canvasToPngBuffer(beforeCanvas);
    const beforeScreenshotRef = await writeScreenshot(tracePaths, 'step-0-before.png', beforeScreenshotBuffer);

    const afterCanvas = createCalculatorCanvas(options.expectedResult);
    const afterScreenshotBuffer = canvasToPngBuffer(afterCanvas);
    const afterScreenshotRef = await writeScreenshot(tracePaths, 'step-1-after.png', afterScreenshotBuffer);

    const actionResponse = buildMockActionResponse(calculatorAction);
    await appendJsonLine(tracePaths.actionTracePath, {
      timestamp: new Date().toISOString(),
      requestId: actionResponse.requestId,
      status: actionResponse.status,
      source: 'fallback',
      summary: `Mock calculator executed expression ${options.expression}.`,
      action: calculatorAction,
      expectedResult: options.expectedResult,
      actualResult: options.expectedResult
    });

    const verificationBundle = verifyCalculatorStep({
      beforeScreenshot: beforeScreenshotBuffer,
      afterScreenshot: afterScreenshotBuffer,
      action: calculatorAction,
      beforeRef: beforeScreenshotRef,
      afterRef: afterScreenshotRef,
      expectedResult: options.expectedResult,
      actualResult: options.expectedResult
    });

    await appendJsonLine(tracePaths.verifierTracePath, {
      ...verificationBundle.traceEntry,
      expectedResult: options.expectedResult,
      actualResult: options.expectedResult
    });

    const transition = buildTransition({
      action: calculatorAction,
      beforeRef: beforeScreenshotRef,
      afterRef: afterScreenshotRef,
      verification: verificationBundle.verification,
      safetyEvent: verificationBundle.safetyEvent,
      provenance: 'hybrid',
      targetApp,
      notes: [
        `deterministic-result:${options.expectedResult}`,
        `expected-result:${options.expectedResult}`,
        `expression:${options.expression}`,
        'calculator-mode:standard',
        'mock calculator state machine produced deterministic output.'
      ]
    });

    const replayTrace = buildReplayTrace({
      traceId,
      sessionId,
      targetApp,
      screenshots: [beforeScreenshotRef, afterScreenshotRef],
      summaryReport: reportPath,
      transition,
      verificationPassed: verificationBundle.verification.status === 'passed',
      notes
    });

    await writeJson(tracePaths.replayTracePath, replayTrace);
    await writeStage3Report({
      reportPath,
      mode: 'mock',
      task: options.task,
      brokerBringUp,
      replayTrace,
      expectedResult: options.expectedResult,
      actualResult: options.expectedResult,
      notes
    });

    return {
      mode: 'mock',
      outputDir: tracePaths.outputDir,
      reportPath,
      replayTracePath: tracePaths.replayTracePath,
      aiSource: 'fallback',
      brokerBringUp
    };
  }

  await ensureCalculatorVisible();

  const beforeCapture = await captureRealScreenshot({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    targetApp,
    tracePaths,
    screenshotName: 'step-0-before.png'
  });

  await invokeBrokerAction({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    requestId: createId('broker-standard-mode'),
    targetApp,
    action: {
      kind: 'keypress',
      keys: ['ALT', '1'],
      target: 'calculator-mode'
    }
  });

  await invokeBrokerAction({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    requestId: createId('broker-clear-calculator'),
    targetApp,
    action: {
      kind: 'keypress',
      keys: ['ESC'],
      target: 'calculator-clear'
    }
  });

  await invokeBrokerAction({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    requestId: createId('broker-clear-calculator-2'),
    targetApp,
    action: {
      kind: 'keypress',
      keys: ['ESC'],
      target: 'calculator-clear'
    }
  });

  await invokeBrokerAction({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    requestId: createId('broker-calc-left'),
    targetApp,
    action: {
      kind: 'type',
      text: sequence.leftOperand,
      target: 'calculator-left-operand'
    }
  });

  await invokeBrokerAction({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    requestId: createId('broker-calc-add'),
    targetApp,
    action: {
      kind: 'type',
      text: sequence.operatorKey === 'ADD' ? '+' : '-',
      target: 'calculator-add-operator'
    }
  });

  await invokeBrokerAction({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    requestId: createId('broker-calc-right'),
    targetApp,
    action: {
      kind: 'type',
      text: sequence.rightOperand,
      target: 'calculator-right-operand'
    }
  });

  const actionResponse = await invokeBrokerAction({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    requestId: createId('broker-calc-enter'),
    targetApp,
    action: {
      kind: 'keypress',
      keys: ['ENTER'],
      target: 'calculator-evaluate'
    }
  });

  if (actionResponse.status !== 'executed') {
    throw new Error(`Calculator action failed: ${actionResponse.error?.message ?? actionResponse.status}`);
  }

  const afterCapture = await captureRealScreenshot({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    targetApp,
    tracePaths,
    screenshotName: 'step-1-after.png'
  });

  const actualResult = await readCalculatorResult({
    screenshot: afterCapture.buffer,
    outputDir: tracePaths.outputDir,
    aiBaseUrl: options.aiBaseUrl,
    aiKey: options.aiKey,
    expectedResult: options.expectedResult,
    task: options.task
  });

  await appendJsonLine(tracePaths.actionTracePath, {
    timestamp: new Date().toISOString(),
    requestId: actionResponse.requestId,
    status: actionResponse.status,
    source: 'deterministic-calculator',
    summary: `Executed calculator expression ${options.expression} via split operand/operator sequence.`,
    action: calculatorAction,
    expectedResult: options.expectedResult,
    actualResult
  });

  const verificationBundle = verifyCalculatorStep({
    beforeScreenshot: beforeCapture.buffer,
    afterScreenshot: afterCapture.buffer,
    action: calculatorAction,
    beforeRef: beforeCapture.relativePath,
    afterRef: afterCapture.relativePath,
    expectedResult: options.expectedResult,
    actualResult
  });

  await appendJsonLine(tracePaths.verifierTracePath, {
    ...verificationBundle.traceEntry,
    expectedResult: options.expectedResult,
    actualResult
  });

  const transition = buildTransition({
    action: calculatorAction,
    beforeRef: beforeCapture.relativePath,
    afterRef: afterCapture.relativePath,
    verification: verificationBundle.verification,
    safetyEvent: verificationBundle.safetyEvent,
    provenance: 'computer_use',
    targetApp,
      notes: [
        `deterministic-result:${actualResult}`,
        `expected-result:${options.expectedResult}`,
        `expression:${options.expression}`,
        'calculator-mode:standard',
        `Broker endpoint: ${realBrokerEndpoint}`
      ]
  });

  const replayTrace = buildReplayTrace({
    traceId,
    sessionId,
    targetApp,
    screenshots: [beforeCapture.relativePath, afterCapture.relativePath],
    summaryReport: reportPath,
    transition,
    verificationPassed: verificationBundle.verification.status === 'passed',
    notes
  });

  await writeJson(tracePaths.replayTracePath, replayTrace);
  await writeStage3Report({
    reportPath,
    mode: 'real',
    task: options.task,
    brokerBringUp,
    replayTrace,
    expectedResult: options.expectedResult,
    actualResult,
    notes
  });

  return {
    mode: 'real',
    outputDir: tracePaths.outputDir,
    reportPath,
    replayTracePath: tracePaths.replayTracePath,
    aiSource: 'ai',
    brokerBringUp
  };
}

export async function runGenericDemo(options: RunGenericDemoOptions): Promise<PaintRunResult> {
  const tracePaths = await ensureTracePaths(options.outputDir);
  const phaseMarkerPath = path.join(tracePaths.outputDir, 'phase-marker.log');
  const sessionId = createId('generic-session');
  const traceId = createId('generic-trace');
  const reportPath = options.reportPath ?? path.join('docs', 'reports', 'generic-app-demo.md');
  const targetApp = options.targetApp;
  const objectiveText = resolveGenericPlannerObjectiveText({
    task: options.task,
    targetApp,
    plannerContext: options.plannerContext,
  });
  const realBrokerEndpoint = options.brokerEndpoint ?? DEFAULT_REAL_BROKER_ENDPOINT;
  const brokerBringUp: BrokerBringUp =
    options.mode === 'real'
      ? await ensureRealBroker(realBrokerEndpoint, options.brokerApiKey, options.startBrokerIfNeeded)
      : {
          mode: 'mock',
          command: 'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File windows-broker/scripts/start-desktop-broker.ps1',
          executed: false,
          note: 'Mock mode uses an in-process canvas instead of Windows actuation.'
        };

  const notes: string[] = [brokerBringUp.note];

  if (options.mode === 'mock') {
    const initialCanvas = createPaintCanvas();
    const beforeScreenshotBuffer = canvasToPngBuffer(initialCanvas);
    const beforeScreenshotRef = await writeScreenshot(tracePaths, 'step-0-before.png', beforeScreenshotBuffer);

    const plannerDecision = await planGenericAction({
      task: objectiveText,
      targetApp,
      screenshot: beforeScreenshotBuffer,
      outputDir: tracePaths.outputDir,
      aiBaseUrl: options.aiBaseUrl,
      aiKey: options.aiKey,
      requireLiveAi: false,
      plannerContext: options.plannerContext
    });

    const nextCanvas = applyActionToCanvas(initialCanvas, plannerDecision.action);
    const afterScreenshotBuffer = canvasToPngBuffer(nextCanvas);
    const afterScreenshotRef = await writeScreenshot(tracePaths, 'step-1-after.png', afterScreenshotBuffer);

    const actionResponse = buildMockActionResponse(plannerDecision.action);
    await writeDebugJsonIfEnabled(tracePaths.outputDir, 'action-decision.json', {
      planner_source: plannerDecision.source,
      planner_attempt_count: plannerDecision.plannerAttemptCount ?? 0,
      planner_action: plannerDecision.action,
      validation: plannerDecision.validation ?? { accepted: true },
      fallback_used: plannerDecision.source === 'fallback',
      executed_action: plannerDecision.action
    } satisfies ActionDecisionArtifact);
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
      targetApp,
      notes:
        plannerDecision.source === 'fallback'
          ? ['AI unavailable, fallback planner used for generic mock verification.']
          : undefined
    });

    const replayTrace = buildReplayTrace({
      traceId,
      sessionId,
      targetApp,
      screenshots: [beforeScreenshotRef, afterScreenshotRef],
      summaryReport: reportPath,
      transition,
      verificationPassed: verificationBundle.verification.status === 'passed',
      notes: plannerDecision.source === 'fallback' ? ['Mock broker used for validation; real broker pipeline is available via --mode real.'] : notes
    });

    await writeJson(tracePaths.replayTracePath, replayTrace);
    await writeGenericReport({
      reportPath,
      mode: 'mock',
      task: objectiveText,
      targetApp,
      aiSource: plannerDecision.source,
      aiTransport: plannerDecision.transport,
      brokerBringUp,
      replayTrace,
      notes
    });

    return {
      mode: 'mock',
      outputDir: tracePaths.outputDir,
      reportPath,
      replayTracePath: tracePaths.replayTracePath,
      aiSource: plannerDecision.source,
      brokerBringUp
    };
  }

  await appendPhaseMarker(phaseMarkerPath, 'before_ensure_target_app_visible');
  const operationForegroundBefore = await captureForegroundWindowSnapshot();
  await ensureTargetAppVisible({
    targetApp,
    launchCommand: options.launchCommand,
    windowTitle: options.windowTitle
  });
  await appendPhaseMarker(phaseMarkerPath, 'after_ensure_target_app_visible');

  await appendPhaseMarker(phaseMarkerPath, 'before_first_screenshot');

  const beforeCapture = await captureRealScreenshot({
    endpoint: realBrokerEndpoint,
    brokerApiKey: options.brokerApiKey,
    sessionId,
    targetApp,
    tracePaths,
    screenshotName: 'step-0-before.png'
  });

  await appendPhaseMarker(phaseMarkerPath, 'after_first_screenshot');
  await appendPhaseMarker(phaseMarkerPath, 'before_planner');

  const plannerDecision = await planGenericAction({
    task: objectiveText,
    targetApp,
    screenshot: beforeCapture.buffer,
    outputDir: tracePaths.outputDir,
    aiBaseUrl: options.aiBaseUrl,
    aiKey: options.aiKey,
    requireLiveAi: true,
    plannerContext: options.plannerContext
  });
  await appendPhaseMarker(phaseMarkerPath, 'after_planner');
  await appendPhaseMarker(phaseMarkerPath, 'before_broker_action');

  const actionResponse = plannerDecision.action.kind === 'wait'
    ? buildWaitActionResponse()
    : await invokeBrokerAction({
      endpoint: realBrokerEndpoint,
      brokerApiKey: options.brokerApiKey,
      sessionId,
      action: plannerDecision.action,
      targetApp,
      requestId: createId('broker-generic-action')
    });

  await writeDebugJsonIfEnabled(tracePaths.outputDir, 'action-decision.json', {
    planner_source: plannerDecision.source,
    planner_attempt_count: plannerDecision.plannerAttemptCount ?? 0,
    planner_action: plannerDecision.action,
    validation: plannerDecision.validation ?? { accepted: true },
    fallback_used: plannerDecision.source === 'fallback',
    executed_action: plannerDecision.action
  } satisfies ActionDecisionArtifact);

  await appendPhaseMarker(phaseMarkerPath, 'after_broker_action');

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

  const settleStartedAt = Date.now();
  let screenshotIndex = 0;
  await appendPhaseMarker(phaseMarkerPath, 'before_verifier');
  const verificationBundle = await settleAndVerifyGenericAction({
    beforeScreenshot: beforeCapture.buffer,
    beforeRef: beforeCapture.relativePath,
    action: plannerDecision.action,
    captureScreenshotAtOffset: async (offsetMs) => {
      const remainingDelayMs = Math.max(0, offsetMs - (Date.now() - settleStartedAt));
      if (remainingDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingDelayMs));
      }

      const capture = await captureRealScreenshot({
        endpoint: realBrokerEndpoint,
        brokerApiKey: options.brokerApiKey,
        sessionId,
        targetApp,
        tracePaths,
        screenshotName: `step-1-after-${screenshotIndex}.png`
      });

      screenshotIndex += 1;
      return {
        buffer: capture.buffer,
        screenshotRef: capture.relativePath
      };
    },
    classifyScreenshotPair: async ({ before, candidate, offsetMs }) =>
      classifyGenericScreenshotPair({
        beforeScreenshot: before,
        candidateScreenshot: candidate,
        offsetMs,
        action: plannerDecision.action,
        task: objectiveText,
        targetApp,
        outputDir: tracePaths.outputDir,
        aiBaseUrl: options.aiBaseUrl,
        aiKey: options.aiKey,
        plannerContext: options.plannerContext,
      })
  });
  await appendPhaseMarker(phaseMarkerPath, 'after_verifier');

  for (const traceEntry of verificationBundle.traceEntries) {
    await appendJsonLine(tracePaths.verifierTracePath, traceEntry);
  }
  const transition = buildTransition({
    action: plannerDecision.action,
    beforeRef: beforeCapture.relativePath,
    afterRef: verificationBundle.finalAfterRef,
    verification: verificationBundle.verification,
    safetyEvent: verificationBundle.safetyEvent,
    provenance: 'computer_use',
    targetApp,
    notes: [
      `Broker endpoint: ${realBrokerEndpoint}`,
      `Windows sandbox root: ${WINDOWS_FILE_SANDBOX_ROOT}`
    ]
  });

  const replayTrace = buildReplayTrace({
    traceId,
    sessionId,
    targetApp,
    screenshots: [beforeCapture.relativePath, ...verificationBundle.screenshotRefs],
    summaryReport: reportPath,
    transition,
    verificationPassed: verificationBundle.verification.status === 'passed',
    notes
  });

  const operationForegroundAfter = await captureForegroundWindowSnapshot();
  await writeJson(path.join(tracePaths.outputDir, 'run-report.json'), buildGenericRunReport({
    action: plannerDecision.action,
    actionResponse,
    verification: verificationBundle.verification,
    foregroundBefore: operationForegroundBefore,
    foregroundAfter: operationForegroundAfter
  }));
  await writeJson(tracePaths.replayTracePath, replayTrace);
  await writeGenericReport({
    reportPath,
    mode: 'real',
    task: objectiveText,
    targetApp,
    aiSource: plannerDecision.source,
    aiTransport: plannerDecision.transport,
    brokerBringUp,
    replayTrace,
    notes
  });

  return {
    mode: 'real',
    outputDir: tracePaths.outputDir,
    reportPath,
    replayTracePath: tracePaths.replayTracePath,
    aiSource: plannerDecision.source,
    brokerBringUp
  };
}

async function appendPhaseMarker(filePath: string, marker: string): Promise<void> {
  await fs.appendFile(filePath, `${marker}\n`, 'utf8');
}

export async function settleAndVerifyGenericAction(params: {
  beforeScreenshot: Buffer;
  captureScreenshotAtOffset: (offsetMs: number) => Promise<{ buffer: Buffer; screenshotRef: string }>;
  classifyScreenshotPair: (input: { before: Buffer; candidate: Buffer; offsetMs: number }) => Promise<GenericSemanticClassification>;
  action: BrokerAction;
  beforeRef: string;
}): Promise<GenericSettleVerificationBundle> {
  const traceEntries: VerificationTraceEntry[] = [];
  const screenshotRefs: string[] = [];
  const samples: SettleSample[] = [];

  const firstCapture = await params.captureScreenshotAtOffset(0);
  screenshotRefs.push(firstCapture.screenshotRef);

  const firstDeltaFromBefore = measureVisualDelta(params.beforeScreenshot, firstCapture.buffer);
  const firstClassification = await params.classifyScreenshotPair({
    before: params.beforeScreenshot,
    candidate: firstCapture.buffer,
    offsetMs: 0
  });

  let latestSemanticState = firstClassification.semanticState;
  let latestSemanticSummary = firstClassification.summary;
  let latestClassificationKind = firstClassification.classificationKind;
  let latestTrustedSemanticState: SemanticSettleState | undefined =
    firstClassification.classificationKind?.startsWith('verifier_') ? undefined : firstClassification.semanticState;
  let previousBuffer = firstCapture.buffer;

  samples.push({
    offsetMs: 0,
    screenshotRef: firstCapture.screenshotRef,
    changedPixelsFromBefore: firstDeltaFromBefore.changedPixels,
    changedBytesFromBefore: firstDeltaFromBefore.changedBytes,
    semanticState: firstClassification.semanticState,
    semanticSummary: firstClassification.summary,
    aiInvoked: true
  });
  traceEntries.push({
    timestamp: new Date().toISOString(),
    method: 'semantic-settle-window',
    changedBytes: firstDeltaFromBefore.changedBytes,
    changedPixels: firstDeltaFromBefore.changedPixels,
    actionKind: params.action.kind,
    status: deriveVerificationStatus(firstClassification.semanticState),
    summary: firstClassification.summary,
    offsetMs: 0,
    screenshotRef: firstCapture.screenshotRef,
    aiInvoked: true,
    semanticState: firstClassification.semanticState
  });

  const settleSchedule = buildSettleSchedule({ firstSemanticState: firstClassification.semanticState });
  for (const offsetMs of settleSchedule.offsetsMs) {
    const capture = await params.captureScreenshotAtOffset(offsetMs);
    screenshotRefs.push(capture.screenshotRef);

    const deltaFromBefore = measureVisualDelta(params.beforeScreenshot, capture.buffer);
    const deltaFromPrevious = measureVisualDelta(previousBuffer, capture.buffer);
    const aiInvoked = shouldInvokeSemanticJudge({
      changedPixels: deltaFromPrevious.changedPixels,
      changedBytes: deltaFromPrevious.changedBytes
    });

    if (aiInvoked) {
      const classification = await params.classifyScreenshotPair({
        before: params.beforeScreenshot,
        candidate: capture.buffer,
        offsetMs
      });
      latestSemanticState = classification.semanticState;
      latestSemanticSummary = classification.summary;
      latestClassificationKind = classification.classificationKind;
      if (!classification.classificationKind?.startsWith('verifier_')) {
        latestTrustedSemanticState = classification.semanticState;
      }
    }

    const propagatedSemanticState =
      aiInvoked || latestTrustedSemanticState !== undefined
        ? latestSemanticState
        : undefined;

    samples.push({
      offsetMs,
      screenshotRef: capture.screenshotRef,
      changedPixelsFromBefore: deltaFromBefore.changedPixels,
      changedBytesFromBefore: deltaFromBefore.changedBytes,
      changedPixelsFromPrevious: deltaFromPrevious.changedPixels,
      changedBytesFromPrevious: deltaFromPrevious.changedBytes,
      semanticState: propagatedSemanticState,
      semanticSummary: latestSemanticSummary,
      aiInvoked
    });
    traceEntries.push({
      timestamp: new Date().toISOString(),
      method: 'semantic-settle-window',
      changedBytes: deltaFromBefore.changedBytes,
      changedPixels: deltaFromBefore.changedPixels,
      changedBytesFromPrevious: deltaFromPrevious.changedBytes,
      changedPixelsFromPrevious: deltaFromPrevious.changedPixels,
      actionKind: params.action.kind,
      status: deriveVerificationStatus(latestSemanticState),
      summary:
        aiInvoked
          ? latestSemanticSummary
          : buildSettleReuseSummary({
              semanticState: latestSemanticState,
              classificationKind: latestClassificationKind
            }),
      offsetMs,
      screenshotRef: capture.screenshotRef,
      aiInvoked,
      semanticState: propagatedSemanticState
    });

    previousBuffer = capture.buffer;
  }

  const { winningSample: candidateWinningSample, finalStableSample } = selectBestEvidenceSample(samples);
  const judgedSamples = samples.filter((sample) => sample.aiInvoked);
  const winningSample = candidateWinningSample?.aiInvoked
    ? candidateWinningSample
    : selectBestEvidenceSample(judgedSamples).winningSample;
  const winningSemanticState = winningSample?.semanticState ?? firstClassification.semanticState;
  const winningSummary = winningSample?.semanticSummary ?? firstClassification.summary;
  const finalAfterRef = finalStableSample?.screenshotRef ?? firstCapture.screenshotRef;
  const evidenceRefs = [...new Set([
    firstCapture.screenshotRef,
    winningSample?.screenshotRef,
    finalStableSample?.screenshotRef
  ].filter((value): value is string => typeof value === 'string'))];

  return {
    verification: {
      status: deriveVerificationStatus(winningSemanticState),
      method: 'semantic-settle-window',
      summary: buildSettleVerificationSummary({ winningSummary, winningSample, finalStableSample }),
      semanticState: winningSemanticState,
      winningScreenshotRef: winningSample?.screenshotRef,
      finalStableScreenshotRef: finalStableSample?.screenshotRef,
      evidenceRefs
    },
    traceEntries,
    safetyEvent: {
      decision: deriveVerificationStatus(winningSemanticState) === 'passed' ? 'allowed' : 'review_required',
      reason:
        deriveVerificationStatus(winningSemanticState) === 'passed'
          ? 'Semantic settle window found success-like evidence after the bounded action.'
          : 'Semantic settle window did not produce success-like evidence after the bounded action.',
      policyRefs: ['semantic-settle-window']
    },
    screenshotRefs,
    finalAfterRef
  };
}

function summarizeStructuredVisualTarget(target?: StructuredVisualTarget): string | undefined {
  return target?.text ?? target?.description ?? target?.nearText ?? undefined;
}

function summarizeStructuredRegionHint(regionHint?: StructuredRegionHint): string | undefined {
  return regionHint?.label;
}

function summarizeStructuredWaitCondition(condition?: StructuredWaitCondition): string | undefined {
  return condition?.text ?? condition?.titleSubstring ?? condition?.type ?? undefined;
}

function summarizeStructuredOperationTarget(operation?: StructuredRunnerOperation): string | undefined {
  return summarizeStructuredVisualTarget(operation?.target)
    ?? summarizeStructuredVisualTarget(operation?.sourceTarget)
    ?? summarizeStructuredVisualTarget(operation?.destinationTarget)
    ?? summarizeStructuredRegionHint(operation?.regionHint)
    ?? summarizeStructuredRegionHint(operation?.sourceRegionHint)
    ?? summarizeStructuredRegionHint(operation?.destinationRegionHint)
    ?? summarizeStructuredWaitCondition(operation?.condition);
}

function normalizeStructuredActionKind(operation?: StructuredRunnerOperation): string | undefined {
  if (typeof operation?.actionKind === 'string' && operation.actionKind.length > 0) {
    return operation.actionKind;
  }

  if (typeof operation?.toolName === 'string' && operation.toolName.startsWith('cua_')) {
    return operation.toolName.slice('cua_'.length);
  }

  return undefined;
}

function createStructuredActionTargetLabel(params: { targetApp: string; operation?: StructuredRunnerOperation }): string {
  return summarizeStructuredOperationTarget(params.operation) ?? params.targetApp;
}

export function resolveStructuredGenericPlannerDecision(params: {
  targetApp: string;
  plannerContext?: GenericPlannerContext;
}): PlannerDecision | undefined {
  const operation = params.plannerContext?.operation;
  const actionKind = normalizeStructuredActionKind(operation);
  if (!operation || !actionKind) {
    return undefined;
  }

  const targetLabel = createStructuredActionTargetLabel({
    targetApp: params.targetApp,
    operation,
  });

  switch (actionKind) {
    case 'type': {
      if (typeof operation.text !== 'string' || operation.text.length === 0) {
        return undefined;
      }
      if (operation.target || operation.clearFirst) {
        return undefined;
      }
      return {
        source: 'structured',
        summary: `Structured request selected a native type action for ${targetLabel}.`,
        plannerAttemptCount: 0,
        validation: {
          accepted: true,
        },
        action: {
          kind: 'type',
          text: operation.text,
          target: targetLabel,
        },
      };
    }
    case 'press_key':
    case 'keypress': {
      if (!Array.isArray(operation.keys) || operation.keys.length === 0 || !operation.keys.every((key) => typeof key === 'string')) {
        return undefined;
      }
      return {
        source: 'structured',
        summary: `Structured request selected a native keypress action for ${targetLabel}.`,
        plannerAttemptCount: 0,
        validation: {
          accepted: true,
        },
        action: {
          kind: 'keypress',
          keys: operation.keys,
          target: targetLabel,
        },
      };
    }
    case 'wait_for':
    case 'wait': {
      return {
        source: 'structured',
        summary: `Structured request selected a native wait action for ${targetLabel}.`,
        plannerAttemptCount: 0,
        validation: {
          accepted: true,
        },
        action: {
          kind: 'wait',
          target: targetLabel,
        },
      };
    }
    default:
      return undefined;
  }
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

async function planGenericAction(params: {
  task: string;
  targetApp: string;
  screenshot: Buffer;
  outputDir: string;
  aiBaseUrl?: string;
  aiKey?: string;
  requireLiveAi: boolean;
  plannerContext?: GenericPlannerContext;
}): Promise<PlannerDecision> {
  const structuredDecision = resolveStructuredGenericPlannerDecision({
    targetApp: params.targetApp,
    plannerContext: params.plannerContext,
  });
  if (structuredDecision) {
    return structuredDecision;
  }

  if (params.aiBaseUrl && params.aiKey) {
    try {
      return await callAiGenericPlanner(params);
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
    summary: `Fallback planner selected one bounded click action for ${params.targetApp}.`,
    plannerAttemptCount: 0,
    validation: {
      accepted: true
    },
    action: createDefaultGenericAction(params.targetApp)
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
        const failure = classifyAiHttpFailure({ status: response.status, rawText });
        throw new Error(`${failure.message} ${rawText}`);
      }

      const extraction = extractAiTextResult({ transport, rawText });
      if (!extraction.ok) {
        throw new Error(extraction.message);
      }

      const planned = parsePlannerJson(extraction.text);

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

export async function callAiGenericPlanner(params: {
  task: string;
  targetApp: string;
  screenshot: Buffer;
  outputDir: string;
  aiBaseUrl?: string;
  aiKey?: string;
  requireLiveAi: boolean;
  plannerContext?: GenericPlannerContext;
}): Promise<PlannerDecision> {
  const requestPath = path.join(params.outputDir, 'planner-request.json');
  const responsePath = path.join(params.outputDir, 'planner-response.json');
  const plannerAttemptsPath = path.join(params.outputDir, 'planner-attempts.json');
  const plannerErrorPath = path.join(params.outputDir, 'planner-error.json');
  let transport = await detectAiTransport(params.aiBaseUrl ?? '', params.aiKey ?? '');
  const endpoint =
    transport === 'chat.completions'
      ? resolveAiChatCompletionsEndpoint(params.aiBaseUrl ?? '')
      : resolveAiResponsesEndpoint(params.aiBaseUrl ?? '');

  const imageUrl = `data:image/png;base64,${params.screenshot.toString('base64')}`;
  let lastError: PlannerFailure | Error | undefined;
  let rejectionReason: string | undefined;
  const plannerAttempts: PlannerAttemptArtifact[] = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const plannerInstruction = buildGenericPlannerInstruction({
      targetApp: params.targetApp,
      task: params.task,
      plannerContext: params.plannerContext,
      rejectionReason,
    });

    try {
      const attemptPlannerCall = async (transportForAttempt: AiTransport): Promise<
        | { ok: true; text: string }
        | { ok: false; failure: PlannerFailure }
      > => {
        const endpoint =
          transportForAttempt === 'chat.completions'
            ? resolveAiChatCompletionsEndpoint(params.aiBaseUrl ?? '')
            : resolveAiResponsesEndpoint(params.aiBaseUrl ?? '');
        const body = buildGenericPlannerRequestBody({
          transport: transportForAttempt,
          plannerInstruction,
          imageUrl
        });
        const streamed = body.stream === true;
        await writeJson(requestPath, body);

        try {
          const response = await fetchWithTimeout(
            endpoint,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${params.aiKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(body)
            },
            AI_REQUEST_TIMEOUT_MS
          );

          const rawText = await readResponseText(response, streamed);
          await writeText(responsePath, rawText);

          if (!response.ok) {
            const failure = classifyAiHttpFailure({ status: response.status, rawText });
            return {
              ok: false,
              failure: toPlannerFailureFromAiFailure(failure)
            };
          }

          const extraction = streamed
            ? extractStreamedOutputText({ transport: transportForAttempt, rawText })
            : extractAiTextResult({ transport: transportForAttempt, rawText });
          if (!extraction.ok) {
            return {
              ok: false,
              failure: toPlannerFailureFromAiFailure({
                ok: false,
                transport: transportForAttempt,
                failureKind: extraction.failureKind,
                message: extraction.message,
                rawText
              })
            };
          }

          return {
            ok: true,
            text: extraction.text
          };
        } catch (error) {
          const plannerFailure = classifyPlannerFailure(error);
          if (plannerFailure) {
            return {
              ok: false,
              failure: plannerFailure
            };
          }
          throw error;
        }
      };

      const firstPlannerCall = await attemptPlannerCall(transport);
      const plannerCallResult =
        !firstPlannerCall.ok && firstPlannerCall.failure.kind === 'planner-empty-response'
          ? await (() => {
              transport = chooseRetryTransport({
                currentTransport: transport,
                failureKind: 'empty_completion'
              });
              return attemptPlannerCall(transport);
            })()
          : firstPlannerCall;

      if (!plannerCallResult.ok) {
        plannerAttempts.push({
          attempt,
          status: 'failure',
          transport,
          request_artifact: path.basename(requestPath),
          response_artifact: path.basename(responsePath),
          failure_kind: plannerCallResult.failure.kind,
          retryable: plannerCallResult.failure.retryable,
          message: plannerCallResult.failure.message,
        });
        await writeDebugJsonIfEnabled(params.outputDir, path.basename(plannerAttemptsPath), { attempts: plannerAttempts });
        if (
          !firstPlannerCall.ok &&
          firstPlannerCall.failure.kind === 'planner-empty-response' &&
          plannerCallResult.failure.kind === 'planner-empty-response'
        ) {
          throw createPlannerFailure(
            'planner-empty-response',
            `${plannerCallResult.failure.message} persisted after retry.`,
            false,
            plannerCallResult.failure.cause
          );
        }

        throw plannerCallResult.failure;
      }

      const planned = parseGenericPlannerJson(plannerCallResult.text, params.targetApp);
      const violation = validateGenericPlannerAction(planned.action, params.targetApp, params.plannerContext);
      if (violation) {
        rejectionReason = violation;
        plannerAttempts.push({
          attempt,
          status: 'failure',
          transport,
          planner_action_kind: planned.action.kind,
          request_artifact: path.basename(requestPath),
          response_artifact: path.basename(responsePath),
          failure_kind: 'planner-action-rejected',
          retryable: false,
          message: `planner-action-rejected: ${violation}`,
          rejection_reason: violation,
        });
        await writeDebugJsonIfEnabled(params.outputDir, path.basename(plannerAttemptsPath), { attempts: plannerAttempts });
        await writeDebugJsonIfEnabled(params.outputDir, path.basename(plannerErrorPath), {
          kind: 'planner-action-rejected',
          retryable: false,
          message: `planner-action-rejected: ${violation}`,
          rejection_reason: violation,
          attempt,
        });
        throw createPlannerFailure('planner-action-rejected', `planner-action-rejected: ${violation}`, false);
      }

       plannerAttempts.push({
         attempt,
         status: 'success',
         transport,
         planner_action_kind: planned.action.kind,
         request_artifact: path.basename(requestPath),
         response_artifact: path.basename(responsePath),
       });
       await writeDebugJsonIfEnabled(params.outputDir, path.basename(plannerAttemptsPath), { attempts: plannerAttempts });

      return {
        source: 'ai',
        transport,
        summary: planned.summary,
        plannerAttemptCount: plannerAttempts.length,
        validation: {
          accepted: true
        },
        action: planned.action,
        requestArtifact: path.basename(requestPath),
        responseArtifact: path.basename(responsePath)
      };
    } catch (error) {
      const plannerFailure = classifyPlannerFailure(error);
      lastError = plannerFailure ?? (error instanceof Error ? error : new Error(String(error)));
      if (plannerFailure) {
        console.error(`[planner] ${plannerFailure.message}`);
      }
      if (!plannerFailure?.retryable || attempt === 3) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  if (lastError && isDebugHarnessEnabled()) {
    await writeDebugJsonIfEnabled(params.outputDir, path.basename(plannerAttemptsPath), { attempts: plannerAttempts });
    await writeDebugJsonIfEnabled(params.outputDir, path.basename(plannerErrorPath), {
      kind: (lastError as Partial<PlannerFailure>).kind,
      retryable: (lastError as Partial<PlannerFailure>).retryable,
      message: lastError.message,
      attempt_count: plannerAttempts.length,
    });
  }

  throw lastError ?? new Error('AI planner failed without an explicit error.');
}

function parseGenericPlannerJson(outputText: string, defaultTarget: string): { summary: string; action: BrokerAction } {
  const start = outputText.indexOf('{');
  const end = outputText.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? outputText.slice(start, end + 1) : outputText;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch (error) {
    throw createPlannerFailure('planner-invalid-json', 'planner-invalid-json: AI planner returned malformed JSON.', false, error);
  }

  if (!isRecord(parsed)) {
    throw createPlannerFailure('planner-shape-mismatch', 'planner-shape-mismatch: AI planner returned a non-object payload.', false);
  }

  let action: BrokerAction;
  try {
    action = parsePlannerAction(parsed.action, defaultTarget);
  } catch (error) {
    throw createPlannerFailure('planner-shape-mismatch', `planner-shape-mismatch: ${error instanceof Error ? error.message : String(error)}`, false, error);
  }

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : `GPT-5.4 planned one bounded action for ${defaultTarget}.`,
    action
  };
}

export function parsePlannerAction(actionValue: unknown, defaultTarget: string): BrokerAction {
  if (!isRecord(actionValue) || typeof actionValue.kind !== 'string') {
    throw new Error('AI planner action payload is invalid.');
  }

  const target = typeof actionValue.target === 'string' ? actionValue.target : defaultTarget;
  switch (actionValue.kind) {
    case 'click': {
      const buttonValue = actionValue.button;
      const button: 'left' | 'right' | 'middle' =
        buttonValue === 'right' || buttonValue === 'middle' || buttonValue === 'left' ? buttonValue : 'left';
      return {
        kind: 'click',
        button,
        position: parsePoint(actionValue.position),
        target
      };
    }
    case 'double_click': {
      const buttonValue = actionValue.button;
      const button: 'left' | 'right' | 'middle' =
        buttonValue === 'right' || buttonValue === 'middle' || buttonValue === 'left' ? buttonValue : 'left';
      return {
        kind: 'double_click',
        button,
        position: parsePoint(actionValue.position),
        target
      };
    }
    case 'type': {
      if (typeof actionValue.text !== 'string' || actionValue.text.length === 0) {
        throw new Error('Type action requires non-empty text.');
      }
      return {
        kind: 'type',
        text: actionValue.text,
        target
      };
    }
    case 'hotkey':
    case 'keypress': {
      if (!Array.isArray(actionValue.keys) || actionValue.keys.length === 0 || !actionValue.keys.every((key) => typeof key === 'string')) {
        throw new Error('Keypress action requires a non-empty keys array.');
      }
      return {
        kind: 'keypress',
        keys: actionValue.keys,
        target
      };
    }
    case 'move': {
      return {
        kind: 'move',
        position: parsePoint(actionValue.position),
        target
      };
    }
    case 'scroll': {
      if (actionValue.delta_x !== undefined && typeof actionValue.delta_x !== 'number') {
        throw new Error('Scroll action delta_x must be numeric when provided.');
      }
      if (actionValue.delta_y !== undefined && typeof actionValue.delta_y !== 'number') {
        throw new Error('Scroll action delta_y must be numeric when provided.');
      }
      if (typeof actionValue.delta_x !== 'number' && typeof actionValue.delta_y !== 'number') {
        throw new Error('Scroll action requires at least one numeric delta_x or delta_y.');
      }
      if (actionValue.keys !== undefined && (!Array.isArray(actionValue.keys) || !actionValue.keys.every((key) => typeof key === 'string'))) {
        throw new Error('Scroll action keys must be a string array when provided.');
      }
      return {
        kind: 'scroll',
        position: actionValue.position === undefined ? undefined : parsePoint(actionValue.position),
        delta_x: typeof actionValue.delta_x === 'number' ? actionValue.delta_x : 0,
        delta_y: typeof actionValue.delta_y === 'number' ? actionValue.delta_y : 0,
        keys: Array.isArray(actionValue.keys) ? actionValue.keys : undefined,
        target
      };
    }
    case 'drag': {
      return {
        kind: 'drag',
        from: parsePoint(actionValue.from),
        to: parsePoint(actionValue.to),
        target
      };
    }
    case 'wait': {
      return {
        kind: 'wait',
        target
      };
    }
    default:
      throw new Error(`Unsupported planner action kind: ${actionValue.kind}`);
  }
}

export function extractOutputTextFromPayload(payload: unknown): ExtractedTextResult {
  if (!isRecord(payload)) {
    return {
      ok: false,
      failureKind: 'shape_mismatch',
      message: 'AI payload is not an object.'
    };
  }

  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0];
    if (isRecord(firstChoice) && isRecord(firstChoice.message)) {
      if (typeof firstChoice.message.content === 'string' && firstChoice.message.content.length > 0) {
        return {
          ok: true,
          text: firstChoice.message.content
        };
      }

      if (firstChoice.message.content === '' || firstChoice.message.content === null) {
        return {
          ok: false,
          failureKind: 'empty_completion',
          message: 'AI payload included an empty chat completion body.'
        };
      }
    }
  }

  if (typeof payload.output_text === 'string' && payload.output_text.length > 0) {
    return {
      ok: true,
      text: payload.output_text
    };
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
      return {
        ok: true,
        text: collected.join('\n')
      };
    }

    return {
      ok: false,
      failureKind: 'shape_mismatch',
      message: 'AI payload output content did not include text items.'
    };
  }

  return {
    ok: false,
    failureKind: 'shape_mismatch',
    message: 'AI payload did not include a supported output text shape.'
  };
}

function extractOutputText(payload: unknown): string {
  const result = extractOutputTextFromPayload(payload);
  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.text;
}

function extractApiErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return undefined;
  }

  return typeof payload.error.message === 'string' ? payload.error.message : undefined;
}

function parseAiPayloadFromRawText(input: { transport: AiTransport; rawText: string }): ParsedAiPayloadResult {
  try {
    return {
      ok: true,
      transport: input.transport,
      rawText: input.rawText,
      payload: JSON.parse(input.rawText) as unknown
    };
  } catch {
    return {
      ok: false,
      transport: input.transport,
      failureKind: 'invalid_json',
      message: 'AI response body did not contain valid top-level JSON.',
      rawText: input.rawText
    };
  }
}

function extractAiTextResult(input: { transport: AiTransport; rawText: string }): AiTextExtractionResult {
  const parsed = parseAiPayloadFromRawText(input);
  if (!parsed.ok) {
    return parsed;
  }

  const apiErrorMessage = extractApiErrorMessage(parsed.payload);
  if (apiErrorMessage) {
    return {
      ok: false,
      transport: parsed.transport,
      failureKind: 'service_error',
      message: `AI service error: ${apiErrorMessage}`,
      rawText: parsed.rawText,
      payload: parsed.payload
    };
  }

  const extracted = extractOutputTextFromPayload(parsed.payload);
  if (!extracted.ok) {
    return {
      ok: false,
      transport: parsed.transport,
      failureKind: extracted.failureKind,
      message: extracted.message,
      rawText: parsed.rawText,
      payload: parsed.payload
    };
  }

  return {
    ok: true,
    transport: parsed.transport,
    rawText: parsed.rawText,
    payload: parsed.payload,
    text: extracted.text
  };
}

export function classifyAiResponseFailure(input: { transport: AiTransport; rawText: string }): AiCallFailureResult | undefined {
  const result = extractAiTextResult(input);
  return result.ok ? undefined : result;
}

export function classifyAiHttpFailure(input: { status: number; rawText: string }): AiCallFailureResult {
  return {
    ok: false,
    failureKind: 'http_error',
    message: `AI request failed with HTTP ${input.status}.`,
    rawText: input.rawText,
    status: input.status
  };
}

export function classifyAiThrownError(error: unknown): AiCallFailureResult | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  if (error.name === 'AbortError' || /timed out|timeout/i.test(error.message)) {
    return {
      ok: false,
      failureKind: 'timeout',
      message: 'The AI request timed out.'
    };
  }

  return undefined;
}

export function chooseRetryTransport(input: {
  currentTransport: AiTransport;
  failureKind: AiCallFailureKind;
}): AiTransport {
  if (input.currentTransport === 'chat.completions' && input.failureKind === 'empty_completion') {
    return 'responses';
  }

  return input.currentTransport;
}

export function buildGenericPlannerRequestBody(input: {
  transport: AiTransport;
  plannerInstruction: string;
  imageUrl: string;
}): Record<string, unknown> {
  return input.transport === 'chat.completions'
    ? {
        model: 'gpt-5.4',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: input.plannerInstruction
              },
              {
                type: 'image_url',
                image_url: {
                  url: input.imageUrl
                }
              }
            ]
          }
        ],
        temperature: 1,
        stream: true
      }
    : {
        model: 'gpt-5.4',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: input.plannerInstruction
              },
              {
                type: 'input_image',
                image_url: input.imageUrl
              }
            ]
          }
        ],
        reasoning_effort: 'none',
        stream: true
      };
}

export function extractStreamedOutputText(input: {
  transport: AiTransport;
  rawText: string;
}):
  | { ok: true; text: string }
  | { ok: false; failureKind: 'empty_completion' | 'shape_mismatch' | 'invalid_json'; message: string } {
  const lines = input.rawText.split(/\r?\n/);
  const collected: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (input.transport === 'chat.completions') {
      if (!trimmed.startsWith('data: ')) {
        continue;
      }
      const data = trimmed.slice('data: '.length);
      if (data === '[DONE]') {
        continue;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(data) as unknown;
      } catch {
        return {
          ok: false,
          failureKind: 'invalid_json',
          message: 'Stream chunk did not contain valid JSON.'
        };
      }
      if (!isRecord(payload) || !Array.isArray(payload.choices)) {
        continue;
      }
      for (const choice of payload.choices) {
        if (!isRecord(choice) || !isRecord(choice.delta)) {
          continue;
        }
        if (typeof choice.delta.content === 'string' && choice.delta.content.length > 0) {
          collected.push(choice.delta.content);
        }
      }
      continue;
    }

    if (!trimmed.startsWith('data: ')) {
      continue;
    }
    const data = trimmed.slice('data: '.length);
    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      return {
        ok: false,
        failureKind: 'invalid_json',
        message: 'Stream chunk did not contain valid JSON.'
      };
    }
    if (!isRecord(payload)) {
      continue;
    }
    if (typeof payload.delta === 'string' && payload.type === 'response.output_text.delta') {
      collected.push(payload.delta);
      continue;
    }
    if (typeof payload.text === 'string' && payload.type === 'response.output_text.done' && collected.length === 0) {
      collected.push(payload.text);
    }
  }

  if (collected.length > 0) {
    return {
      ok: true,
      text: collected.join('')
    };
  }

  return {
    ok: false,
    failureKind: 'empty_completion',
    message: 'AI stream completed without visible output text.'
  };
}

function createPlannerFailure(kind: PlannerFailureKind, message: string, retryable: boolean, cause?: unknown): PlannerFailure {
  const error = new Error(message) as PlannerFailure;
  error.kind = kind;
  error.retryable = retryable;
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

function toPlannerFailureFromAiFailure(failure: AiCallFailureResult): PlannerFailure {
  switch (failure.failureKind) {
    case 'timeout':
      return createPlannerFailure('planner-timeout', `planner-timeout: ${failure.message}`, true, failure);
    case 'http_error':
    case 'service_error': {
      const retryableStatus = failure.status === undefined || [408, 409, 425, 429, 500, 502, 503, 504].includes(failure.status);
      return createPlannerFailure('planner-http-failure', `planner-http-failure: ${failure.message}`, retryableStatus, failure);
    }
    case 'empty_completion':
      return createPlannerFailure('planner-empty-response', `planner-empty-response: ${failure.message}`, false, failure);
    case 'shape_mismatch':
      return createPlannerFailure('planner-shape-mismatch', `planner-shape-mismatch: ${failure.message}`, false, failure);
    case 'invalid_json':
      return createPlannerFailure('planner-invalid-json', `planner-invalid-json: ${failure.message}`, false, failure);
  }
}

function classifyPlannerFailure(error: unknown): PlannerFailure | undefined {
  if (isPlannerFailure(error)) {
    return error;
  }

  const thrownFailure = classifyAiThrownError(error);
  if (thrownFailure) {
    return toPlannerFailureFromAiFailure(thrownFailure);
  }

  return undefined;
}

function isPlannerFailure(error: unknown): error is PlannerFailure {
  return error instanceof Error && 'kind' in error && 'retryable' in error;
}

export async function classifyGenericScreenshotPair(params: {
  beforeScreenshot: Buffer;
  candidateScreenshot: Buffer;
  offsetMs: number;
  action: BrokerAction;
  task?: string;
  targetApp: string;
  outputDir: string;
  aiBaseUrl?: string;
  aiKey?: string;
  plannerContext?: GenericPlannerContext;
}): Promise<GenericSemanticClassification> {
  if (!params.aiBaseUrl || !params.aiKey) {
    throw new Error('Generic settle verification requires URL and KEY.');
  }

  const requestPath = path.join(params.outputDir, `verifier-request-${params.offsetMs}.json`);
  const responsePath = path.join(params.outputDir, `verifier-response-${params.offsetMs}.json`);
  const transport = await detectAiTransport(params.aiBaseUrl, params.aiKey);
  const endpoint =
    transport === 'chat.completions'
      ? resolveAiChatCompletionsEndpoint(params.aiBaseUrl)
      : resolveAiResponsesEndpoint(params.aiBaseUrl);

  const beforeImageUrl = `data:image/png;base64,${params.beforeScreenshot.toString('base64')}`;
  const candidateImageUrl = `data:image/png;base64,${params.candidateScreenshot.toString('base64')}`;
  const instruction = buildGenericVerifierInstruction({
    targetApp: params.targetApp,
    task: params.task,
    plannerContext: params.plannerContext,
    actionKind: params.action.kind,
    offsetMs: params.offsetMs,
  });

  const body =
    transport === 'chat.completions'
      ? {
          model: 'gpt-5.4',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: instruction },
                { type: 'image_url', image_url: { url: beforeImageUrl } },
                { type: 'image_url', image_url: { url: candidateImageUrl } }
              ]
            }
          ],
          temperature: 1,
          stream: true
        }
      : {
          model: 'gpt-5.4',
          input: [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: instruction },
                { type: 'input_image', image_url: beforeImageUrl },
                { type: 'input_image', image_url: candidateImageUrl }
              ]
            }
          ],
          reasoning_effort: 'none',
          stream: true
        };

  await writeJson(requestPath, body);
  const attemptClassification = async (): Promise<
    | { ok: true; classification: GenericSemanticClassification }
    | { ok: false; failureKind: AiCallFailureKind }
  > => {
    const streamed = body.stream === true;
    let response: Response;
    try {
      response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.aiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }, VERIFIER_AI_REQUEST_TIMEOUT_MS);
    } catch (error) {
      const classified = classifyAiThrownError(error);
      if (classified) {
        return {
          ok: false,
          failureKind: classified.failureKind
        };
      }
      throw error;
    }

    const rawText = await readResponseText(response, streamed);
    await writeText(responsePath, rawText);

    if (!response.ok) {
      const failure = classifyAiHttpFailure({ status: response.status, rawText });
      throw new Error(`Generic settle verifier ${failure.message.toLowerCase()}: ${rawText}`);
    }

    const extraction = streamed
      ? extractStreamedOutputText({ transport, rawText })
      : extractAiTextResult({ transport, rawText });
    if (!extraction.ok) {
      return {
        ok: false,
        failureKind: extraction.failureKind
      };
    }

    return {
      ok: true,
      classification: parseGenericSettleClassificationJson(extraction.text)
    };
  };

  const firstAttempt = await attemptClassification();
  if (firstAttempt.ok) {
    return firstAttempt.classification;
  }

  if (firstAttempt.failureKind !== 'empty_completion') {
    return classifySettleVerifierFailure(firstAttempt.failureKind);
  }

  const retryAttempt = await attemptClassification();
  if (retryAttempt.ok) {
    return retryAttempt.classification;
  }

  return classifySettleVerifierFailure(retryAttempt.failureKind, {
    afterEmptyCompletionRetry: true
  });
}

export function parseGenericSettleClassificationJson(outputText: string): GenericSemanticClassification {
  const start = outputText.indexOf('{');
  const end = outputText.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? outputText.slice(start, end + 1) : outputText;
  let parsed: unknown;

  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch {
    return classifySettleVerifierFailure('invalid_json');
  }

  if (!isRecord(parsed)) {
    return classifySettleVerifierFailure('shape_mismatch');
  }

  const semanticState = parsed.semanticState;
  if (
    semanticState !== 'success_like'
    && semanticState !== 'failure_like'
    && semanticState !== 'loading'
    && semanticState !== 'ambiguous'
  ) {
    return {
      semanticState: 'ambiguous',
      classificationKind: 'verifier_shape_mismatch',
      summary: 'Settle verifier shape mismatch: verifier returned an unsupported semanticState value.'
    };
  }

  return {
    semanticState,
    classificationKind: classifySemanticSettleKind(semanticState),
    summary:
      typeof parsed.summary === 'string'
        ? parsed.summary
        : `Semantic settle verifier classified the candidate as ${semanticState}.`
  };
}

function classifySemanticSettleKind(semanticState: SemanticSettleState): GenericSemanticClassification['classificationKind'] {
  switch (semanticState) {
    case 'success_like':
      return 'semantic_success_like';
    case 'failure_like':
      return 'semantic_failure_like';
    case 'loading':
      return 'semantic_loading';
    case 'ambiguous':
      return 'semantic_ambiguous';
  }
}

function classifySettleVerifierFailure(
  failureKind: AiCallFailureKind,
  options?: { afterEmptyCompletionRetry?: boolean }
): GenericSemanticClassification {
  switch (failureKind) {
    case 'timeout':
      return {
        semanticState: 'ambiguous',
        classificationKind: 'verifier_timeout',
        summary: 'Settle verifier timeout: verifier did not return a classification before the request deadline.'
      };
    case 'empty_completion':
      return {
        semanticState: 'ambiguous',
        classificationKind: 'verifier_empty_response',
        summary: options?.afterEmptyCompletionRetry
          ? 'Settle verifier empty response: verifier returned no classification content after 1 retry.'
          : 'Settle verifier empty response: verifier returned no classification content.'
      };
    case 'invalid_json':
      return {
        semanticState: 'ambiguous',
        classificationKind: 'verifier_parse_failure',
        summary: 'Settle verifier parse failure: extracted verifier text could not be decoded as JSON.'
      };
    case 'shape_mismatch':
    case 'service_error':
    case 'http_error':
      return {
        semanticState: 'ambiguous',
        classificationKind: 'verifier_shape_mismatch',
        summary: 'Settle verifier shape mismatch: verifier returned an unsupported response structure.'
      };
  }
}

function buildSettleReuseSummary(params: {
  semanticState: SemanticSettleState;
  classificationKind?: GenericSemanticClassification['classificationKind'];
}): string {
  if (params.classificationKind?.startsWith('verifier_')) {
    return `Pixel gate skipped AI; reusing degraded verifier result ${params.classificationKind} while semantic state remains ${params.semanticState}.`;
  }

  return `Pixel gate skipped AI; reusing semantic state ${params.semanticState} from ${params.classificationKind}.`;
}

function deriveVerificationStatus(semanticState: SemanticSettleState): TransitionEnvelope['verification']['status'] {
  switch (semanticState) {
    case 'success_like':
      return 'passed';
    case 'failure_like':
      return 'failed';
    default:
      return 'unknown';
  }
}

function buildSettleVerificationSummary(params: {
  winningSummary: string;
  winningSample?: SettleSample;
  finalStableSample?: SettleSample;
}): string {
  if (!params.winningSample) {
    return params.winningSummary;
  }

  const stableSuffix =
    params.finalStableSample && params.finalStableSample.screenshotRef !== params.winningSample.screenshotRef
      ? ` Final stable frame came from ${params.finalStableSample.screenshotRef} at ${params.finalStableSample.offsetMs}ms.`
      : '';

  return `${params.winningSummary} Winning evidence came from ${params.winningSample.screenshotRef} at ${params.winningSample.offsetMs}ms.${stableSuffix}`;
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

  const port = Number.parseInt(new URL(endpoint).port || '10578', 10);
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

export async function captureRealScreenshot(params: {
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

  const validation = validateBrokerScreenshotResponse(response);
  if (!validation.ok) {
    throw createBrokerScreenshotContractError(validation);
  }

  const buffer = Buffer.from(validation.artifact.contentBase64, 'base64');
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

function buildWaitActionResponse(): BrokerResponseEnvelope {
  const now = new Date().toISOString();
  return {
    requestId: createId('wait-action'),
    status: 'executed',
    startedAt: now,
    finishedAt: now,
    artifacts: [],
    safetyEvent: {
      decision: 'allowed',
      reason: 'Wait action is handled in the runner without broker execution.',
      policyRefs: ['runner-wait-action']
    },
    stateHandle: {
      stateLabel: 'wait-without-broker'
    }
  };
}

export function buildTransition(params: {
  action: BrokerAction;
  beforeRef: string;
  afterRef: string;
  verification: TransitionEnvelope['verification'];
  safetyEvent: SafetyEvent;
  provenance: Provenance;
  targetApp: string;
  computerUse?: TransitionEnvelope['computerUse'];
  notes?: string[];
}): TransitionEnvelope {
  return {
    transitionId: createId('transition'),
    timestamp: new Date().toISOString(),
    provenance: params.provenance,
    action: params.action,
    before: {
      screenshotRef: params.beforeRef,
      windowRef: params.targetApp,
      stateLabel: 'before-action',
      evidenceRefs: [params.beforeRef]
    },
    after: {
      screenshotRef: params.afterRef,
      windowRef: params.targetApp,
      stateLabel: 'after-action',
      evidenceRefs: [params.afterRef]
    },
    verification: params.verification,
    safetyEvent: params.safetyEvent,
    computerUse: params.computerUse,
    notes: params.notes
  };
}

export function buildReplayTrace(params: {
  traceId: string;
  sessionId: string;
  targetApp: string;
  screenshots: string[];
  summaryReport: string;
  transition: TransitionEnvelope;
  verificationPassed: boolean;
  notes: string[];
  computerUse?: ReplayTrace['computerUse'];
}): ReplayTrace {
  return {
    traceId: params.traceId,
    sessionId: params.sessionId,
    createdAt: new Date().toISOString(),
    target: {
      app: params.targetApp,
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
        transitionId: params.transition.transitionId,
        policyRefs: params.transition.safetyEvent.policyRefs
      }
    ],
    computerUse: params.computerUse
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

async function ensureCalculatorVisible(): Promise<void> {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      "Start-Process 'calculator:'; Start-Sleep -Seconds 2; $shell = New-Object -ComObject WScript.Shell; $null = $shell.AppActivate('Calculator')"
    ],
    {
      encoding: 'utf8'
    }
  );

  if (result.status !== 0) {
    throw new Error(`Failed to launch or activate Calculator: ${result.stderr || result.stdout}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function ensureTargetAppVisible(params: {
  targetApp: string;
  launchCommand?: string;
  windowTitle?: string;
}): Promise<void> {
  const command = buildEnsureTargetAppVisibleCommand(params);

  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', command], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(`Failed to launch or activate target app ${params.targetApp}: ${result.stderr || result.stdout}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));
}

async function captureForegroundWindowSnapshot(): Promise<RunReportForegroundWindowSnapshot | null> {
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', buildCaptureForegroundWindowSnapshotCommand()], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    return null;
  }

  const payload = result.stdout.trim();
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as ForegroundWindowSnapshot | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    return {
      hwnd: parsed.hwnd,
      pid: parsed.pid,
      process_name: parsed.processName,
      window_title: parsed.windowTitle
    };
  } catch {
    return null;
  }
}

function buildCaptureForegroundWindowSnapshotCommand(): string {
  return `$source = @'
using System;
using System.Runtime.InteropServices;

public static class OpenReverseForegroundSnapshot
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
Add-Type -TypeDefinition $source -Language CSharp
$hwnd = [OpenReverseForegroundSnapshot]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { return }
$foregroundPid = 0
[void][OpenReverseForegroundSnapshot]::GetWindowThreadProcessId($hwnd, [ref]$foregroundPid)
$process = $null
try {
  $process = Get-Process -Id $foregroundPid -ErrorAction Stop
} catch {
  $process = $null
}
$title = $null
if ($process) {
  try {
    $title = $process.MainWindowTitle
  } catch {
    $title = $null
  }
}
[pscustomobject]@{
  hwnd = $hwnd.ToInt64().ToString()
  pid = $foregroundPid.ToString()
  processName = if ($process) { $process.ProcessName } else { $null }
  windowTitle = if ([string]::IsNullOrWhiteSpace($title)) { $null } else { $title }
} | ConvertTo-Json -Compress`;
}

function buildGenericRunReport(params: {
  action: BrokerAction;
  actionResponse: BrokerResponseEnvelope;
  verification: TransitionEnvelope['verification'];
  foregroundBefore: RunReportForegroundWindowSnapshot | null;
  foregroundAfter: RunReportForegroundWindowSnapshot | null;
}): GenericRunReport {
  const targetResolved = params.actionResponse.stateHandle?.targetResolved ?? null;
  const targetActivated = params.actionResponse.stateHandle?.targetActivated ?? null;
  const activationReason = inferOperationActivationReason({
    targetActivated,
    foregroundBefore: params.foregroundBefore,
    foregroundAfter: params.foregroundAfter
  });

  return {
    outcome: params.verification.status === 'passed' ? 'pass' : 'fail',
    target_resolved: targetResolved,
    target_activated: targetActivated,
    action_executed: params.actionResponse.status === 'executed',
    action_kind: params.action.kind,
    goal_summary: params.verification.summary ?? null,
    target_activation_reason: activationReason,
    foreground_before: params.foregroundBefore,
    foreground_after: params.foregroundAfter,
    actual_process_name: params.actionResponse.stateHandle?.actualProcessName ?? null,
    actual_window_title: params.actionResponse.stateHandle?.actualWindowTitle ?? null
  };
}

export function buildTopLevelRunnerFailureReport(params: {
  error: unknown;
  actionKind?: BrokerAction['kind'] | null;
}): GenericRunReport | null {
  const error = params.error instanceof Error ? params.error as Error & {
    code?: string;
    reasonCode?: string;
  } : null;

  if (!error || error.code !== 'broker_screenshot_contract_violation') {
    return null;
  }

  const message = typeof error.message === 'string' && error.message.trim()
    ? error.message.trim()
    : 'Broker screenshot response violated the frozen screenshot contract.';

  return {
    outcome: 'fail',
    target_resolved: null,
    target_activated: null,
    action_executed: false,
    action_kind: params.actionKind ?? null,
    goal_summary: message,
    goal_state: 'inconclusive',
    target_activation_reason: null,
    foreground_before: null,
    foreground_after: null,
    actual_process_name: null,
    actual_window_title: null,
    diagnosis_code: 'broker_screenshot_contract_violation',
    diagnosis_summary: message,
    verification_state: 'verification_inconclusive',
    verification_error_code: 'broker_screenshot_contract_violation',
    host_refused: false,
    contract_reason_code: typeof error.reasonCode === 'string' && error.reasonCode.trim()
      ? error.reasonCode.trim()
      : null
  };
}

function inferOperationActivationReason(params: {
  targetActivated: boolean | null;
  foregroundBefore: RunReportForegroundWindowSnapshot | null;
  foregroundAfter: RunReportForegroundWindowSnapshot | null;
}): string | null {
  if (params.targetActivated !== true) {
    return null;
  }

  const beforeLabel = params.foregroundBefore?.process_name ?? params.foregroundBefore?.window_title ?? null;
  const afterLabel = params.foregroundAfter?.process_name ?? params.foregroundAfter?.window_title ?? null;

  if (beforeLabel && afterLabel) {
    const sameWindow = params.foregroundBefore?.hwnd && params.foregroundAfter?.hwnd
      ? params.foregroundBefore.hwnd === params.foregroundAfter.hwnd
      : beforeLabel === afterLabel

    if (sameWindow) {
      return `Target activation was reported by the broker, but the tool-call foreground window was already ${afterLabel} before execution.`
    }

    return `Target was foregrounded from ${beforeLabel} to ${afterLabel} before action execution.`
  }

  return 'Target was activated before action execution.'
}

function buildEnsureTargetAppVisibleCommand(params: {
  targetApp: string;
  launchCommand?: string;
  windowTitle?: string;
}): string {
  const processName = escapePowershellString(normalizeProcessLookupName(params.targetApp));
  const launchTarget = params.launchCommand ? escapePowershellString(params.launchCommand) : undefined;
  const readyWindowPredicate = params.windowTitle
    ? `$_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq ${escapePowershellString(params.windowTitle)}`
    : '$_.MainWindowHandle -ne 0';
  const readyLookup = [
    `$ready = @(Get-Process -Name ${processName} -ErrorAction SilentlyContinue | Where-Object { ${readyWindowPredicate} } | Select-Object -First 1)`,
    `if (-not $ready) { throw 'Unable to find a ready window for ${params.targetApp}.' }`
  ];

  const commandParts = [
    ...(launchTarget ? [`Start-Process ${launchTarget}`, 'Start-Sleep -Seconds 2'] : []),
    ...readyLookup,
    '$shell = New-Object -ComObject WScript.Shell',
    '$null = $shell.AppActivate($ready.Id)'
  ];

  return commandParts.join('; ');
}

async function readCalculatorResult(params: {
  screenshot: Buffer;
  outputDir: string;
  aiBaseUrl?: string;
  aiKey?: string;
  expectedResult: string;
  task: string;
}): Promise<string> {
  if (!params.aiBaseUrl || !params.aiKey) {
    throw new Error('Calculator deterministic read requires URL and KEY.');
  }

  const requestPath = path.join(params.outputDir, 'calculator-read-request.json');
  const responsePath = path.join(params.outputDir, 'calculator-read-response.json');
  const transport = await detectAiTransport(params.aiBaseUrl, params.aiKey);
  const endpoint =
    transport === 'chat.completions'
      ? resolveAiChatCompletionsEndpoint(params.aiBaseUrl)
      : resolveAiResponsesEndpoint(params.aiBaseUrl);
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
                    'You are reading the visible result from Windows Calculator.',
                    `Task context: ${params.task}`,
                    `Expected result: ${params.expectedResult}`,
                    'Return JSON only with this shape: {"display":"<visible calculator result>"}.',
                    'Read only the calculator display value.'
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
                'You are reading the visible result from Windows Calculator.',
                `Task context: ${params.task}`,
                `Expected result: ${params.expectedResult}`,
                'Return JSON only with this shape: {"display":"<visible calculator result>"}.',
                'Read only the calculator display value.'
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

  if (!response.ok) {
    throw new Error(`Calculator read request failed (${response.status}): ${rawText}`);
  }

  const payload = JSON.parse(rawText) as unknown;
  const apiErrorMessage = extractApiErrorMessage(payload);
  if (apiErrorMessage) {
    throw new Error(`Calculator read service error: ${apiErrorMessage}`);
  }

  const outputText = extractOutputText(payload);
  const parsed = JSON.parse(outputText.slice(outputText.indexOf('{'), outputText.lastIndexOf('}') + 1)) as unknown;
  if (!isRecord(parsed) || typeof parsed.display !== 'string') {
    throw new Error('Calculator read response did not contain a display string.');
  }

  return parsed.display.replace(/\s+/g, '');
}

async function writeStage3Report(params: {
  reportPath: string;
  mode: RunMode;
  task: string;
  brokerBringUp: BrokerBringUp;
  replayTrace: ReplayTrace;
  expectedResult: string;
  actualResult: string;
  notes: string[];
}): Promise<void> {
  const screenshots = params.replayTrace.artifacts.screenshots.map((entry) => `  - ${entry}`).join('\n');
  const notes = params.notes.length > 0 ? params.notes.map((note) => `- ${note}`).join('\n') : '- No additional notes.';

  const content = [
    '# Stage 3 Report: Calculator Deterministic Validation',
    '',
    '## Goal',
    '',
    'Demonstrate a Calculator path that produces a deterministic result, reads that result, and verifies the outcome with stronger logic than simple visual-diff checks.',
    '',
    '## Run summary',
    '',
    `- Mode: ${params.mode}`,
    `- Task: ${params.task}`,
    `- Expected result: ${params.expectedResult}`,
    `- Actual result: ${params.actualResult}`,
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
    ''
  ].join('\n');

  await writeText(params.reportPath, content);
}

function parseCalculatorExpression(expression: string): {
  leftOperand: string;
  rightOperand: string;
  operatorKey: 'ADD' | 'SUBTRACT';
} {
  const normalized = expression.replace(/\s+/g, '');
  const match = normalized.match(/^(\d+)([+-])(\d+)=?$/);
  if (!match) {
    throw new Error(`Unsupported calculator expression format: ${expression}`);
  }

  return {
    leftOperand: match[1],
    rightOperand: match[3],
    operatorKey: match[2] === '+' ? 'ADD' : 'SUBTRACT'
  };
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

function createDefaultGenericAction(targetApp: string): BrokerAction {
  return {
    kind: 'click',
    button: 'left',
    position: { x: 64, y: 64 },
    target: targetApp
  };
}

function escapePowershellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeProcessLookupName(value: string): string {
  return value.replace(/\.exe$/i, '');
}

async function writeGenericReport(params: {
  reportPath: string;
  mode: RunMode;
  task: string;
  targetApp: string;
  aiSource: PlannerDecision['source'];
  aiTransport?: PlannerDecision['transport'];
  brokerBringUp: BrokerBringUp;
  replayTrace: ReplayTrace;
  notes: string[];
}): Promise<void> {
  const screenshots = params.replayTrace.artifacts.screenshots.map((entry) => `  - ${entry}`).join('\n');
  const notes = params.notes.length > 0 ? params.notes.map((note) => `- ${note}`).join('\n') : '- No additional notes.';

  const content = [
    '# Generic App Report: One-Step Bounded Action',
    '',
    '## Goal',
    '',
    'Demonstrate one bounded action on a user-selected Windows app with replay artifacts and visual verification.',
    '',
    '## Run summary',
    '',
    `- Mode: ${params.mode}`,
    `- Target app: ${params.targetApp}`,
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
    ''
  ].join('\n');

  await writeText(params.reportPath, content);
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

async function readResponseText(response: Response, streamed: boolean): Promise<string> {
  if (!streamed) {
    return response.text();
  }

  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rawText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    rawText += decoder.decode(value, { stream: true });
  }

  rawText += decoder.decode();
  return rawText;
}

export { DEFAULT_CALCULATOR_TASK, DEFAULT_GENERIC_TASK, DEFAULT_PAINT_TASK, buildEnsureTargetAppVisibleCommand };
