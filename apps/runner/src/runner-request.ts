import fs from 'node:fs';
import path from 'node:path';

export type RunMode = 'mock' | 'real';
export type DemoTarget = 'paint' | 'calculator' | 'any';

export interface GenericRunnerRequestFile {
  targetApp?: string;
  outputDir?: string;
  task?: string;
  reportPath?: string;
  launchCommand?: string;
  windowTitle?: string;
  plannerContext?: unknown;
  structuredRequest?: {
    intent?: string;
    actionKind?: string;
    targetSummary?: string;
    expectedOutcome?: string;
    observationBinding?: string;
  };
}

export interface ResolvedRunnerRequest {
  mode: RunMode;
  target: DemoTarget;
  targetApp?: string;
  outputDir?: string;
  task?: string;
  reportPath?: string;
  launchCommand?: string;
  windowTitle?: string;
  plannerContext?: unknown;
  structuredRequest?: GenericRunnerRequestFile['structuredRequest'];
  requestFilePath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergePlannerContext(plannerContext: unknown, structuredRequest: GenericRunnerRequestFile['structuredRequest']): unknown {
  if (!structuredRequest) {
    return plannerContext;
  }

  const normalizedStructuredRequest = Object.fromEntries(
    Object.entries({
      intent: structuredRequest.intent,
      action_kind: structuredRequest.actionKind,
      target_summary: structuredRequest.targetSummary,
      expected_outcome: structuredRequest.expectedOutcome,
      observation_binding: structuredRequest.observationBinding,
    }).filter(([, value]) => value !== undefined && value !== null),
  );

  if (!isRecord(plannerContext)) {
    return {
      structured_request: normalizedStructuredRequest,
    };
  }

  return {
    ...plannerContext,
    structured_request: {
      ...(isRecord(plannerContext.structured_request) ? plannerContext.structured_request : {}),
      ...normalizedStructuredRequest,
    },
  };
}

export function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

export function readRunnerRequestFile(filePath: string | undefined): GenericRunnerRequestFile | undefined {
  if (!filePath) {
    return undefined;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as GenericRunnerRequestFile;
}

export async function resolveRunnerRequest(input: { args: string[]; env?: NodeJS.ProcessEnv }): Promise<ResolvedRunnerRequest> {
  const args = input.args;
  const env = input.env ?? process.env;
  const requestFilePath = readFlag(args, '--request-file');
  const request = readRunnerRequestFile(requestFilePath);
  const plannerContext = mergePlannerContext(request?.plannerContext, request?.structuredRequest);
  const mode = (readFlag(args, '--mode') ?? env.WINDOWS_BROKER_MODE ?? 'mock') as RunMode;
  const target = (readFlag(args, '--target') ?? 'paint') as DemoTarget;

  return {
    mode,
    target,
    targetApp: readFlag(args, '--target-app') ?? readFlag(args, '--app') ?? request?.targetApp,
    outputDir: readFlag(args, '--output') ?? request?.outputDir,
    task: readFlag(args, '--task') ?? request?.task,
    reportPath: readFlag(args, '--report') ?? request?.reportPath,
    launchCommand: readFlag(args, '--launch-command') ?? request?.launchCommand,
    windowTitle: readFlag(args, '--window-title') ?? request?.windowTitle,
    plannerContext,
    structuredRequest: request?.structuredRequest,
    requestFilePath: requestFilePath ? path.resolve(requestFilePath) : undefined,
  };
}
