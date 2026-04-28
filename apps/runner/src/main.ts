import fs from 'node:fs';
import path from 'node:path';
import demoTargets from '../../../configs/demo-targets.json' with { type: 'json' };
import type { GenericPlannerContext } from './generic-planner-constraints.js';
import { readFlag, resolveRunnerRequest } from './runner-request.js';
import {
  buildTopLevelRunnerFailureReport,
  DEFAULT_CALCULATOR_TASK,
  DEFAULT_GENERIC_TASK,
  DEFAULT_PAINT_TASK,
  runCalculatorDemo,
  runGenericDemo,
  runPaintDemo
} from './loop.js';
import { RunMode } from './traces.js';

type DemoTarget = 'paint' | 'calculator' | 'any';

interface DemoTargetConfig {
  app: string;
  defaultOutputDir: string;
  defaultTask: string;
  reportPath: string;
  expression?: string;
  expectedResult?: string;
}

async function main(): Promise<void> {
  loadEnvFiles(['.env.local', '.env']);

  const args = process.argv.slice(2);
  const runnerRequest = await resolveRunnerRequest({ args, env: process.env });
  const mode = runnerRequest.mode as RunMode;
  const target = runnerRequest.target as DemoTarget;
  if (target !== 'paint' && target !== 'calculator' && target !== 'any') {
    throw new Error(`Unsupported target: ${target}`);
  }

  const targetConfigs = demoTargets as Record<'paint' | 'calculator', DemoTargetConfig>;

  const isAnyTarget = target === 'any';
  const targetConfig = target === 'calculator' ? targetConfigs.calculator : targetConfigs.paint;
  const targetApp = isAnyTarget ? runnerRequest.targetApp : targetConfig.app;

  if (isAnyTarget && !targetApp) {
    throw new Error('When --target any is used, --target-app is required.');
  }

  const genericName = sanitizeName(targetApp ?? 'target-app');
  const outputDir =
    runnerRequest.outputDir ??
    (isAnyTarget ? path.join('artifacts', `custom-${genericName}`) : path.join(targetConfig.defaultOutputDir));
  const task =
    runnerRequest.task ??
    (isAnyTarget
      ? `In ${targetApp}, ${DEFAULT_GENERIC_TASK}`
      : (target === 'calculator' ? DEFAULT_CALCULATOR_TASK : DEFAULT_PAINT_TASK) ?? targetConfig.defaultTask);

  if (mode !== 'mock' && mode !== 'real') {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const commonOptions = {
    mode,
    outputDir,
    task,
    aiBaseUrl: process.env.URL,
    aiKey: process.env.KEY,
    brokerEndpoint: process.env.WINDOWS_BROKER_ENDPOINT,
    brokerApiKey: process.env.WINDOWS_BROKER_API_KEY,
    startBrokerIfNeeded: process.env.WINDOWS_BROKER_START !== 'false'
  };

  try {
    const result =
      target === 'calculator'
        ? await runCalculatorDemo({
            ...commonOptions,
            expression: readFlag(args, '--expression') ?? targetConfig.expression ?? '12+34=',
            expectedResult: readFlag(args, '--expected-result') ?? targetConfig.expectedResult ?? '46',
            reportPath: targetConfig.reportPath,
            targetApp: targetApp ?? targetConfig.app
          })
        : target === 'paint'
          ? await runPaintDemo({
              ...commonOptions,
              reportPath: targetConfig.reportPath,
              targetApp: targetApp ?? targetConfig.app
            })
          : await runGenericDemo({
              ...commonOptions,
              task: runnerRequest.task,
              targetApp: targetApp ?? 'target-app',
              reportPath: runnerRequest.reportPath ?? path.join('docs', 'reports', `custom-${genericName}-report.md`),
              launchCommand: runnerRequest.launchCommand,
              windowTitle: runnerRequest.windowTitle,
              plannerContext: (runnerRequest.plannerContext as GenericPlannerContext | undefined)
                ?? readPlannerContext(readFlag(args, '--planner-context-file'))
            });

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const failureReport = buildTopLevelRunnerFailureReport({
      error,
      actionKind: resolveStructuredActionKind(runnerRequest.structuredRequest?.actionKind)
    });
    if (failureReport) {
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'run-report.json'), `${JSON.stringify(failureReport, null, 2)}\n`, 'utf8');
    }
    throw error;
  }
}

function loadEnvFiles(files: string[]): void {
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

function sanitizeName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'target-app';
}

function readPlannerContext(filePath: string | undefined): GenericPlannerContext | undefined {
  if (!filePath) {
    return undefined;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as GenericPlannerContext;
}

function resolveStructuredActionKind(value: unknown): 'screenshot' | 'click' | 'double_click' | 'type' | 'keypress' | 'move' | 'scroll' | 'drag' | 'wait' | null {
  switch (value) {
    case 'screenshot':
    case 'click':
    case 'double_click':
    case 'type':
    case 'keypress':
    case 'move':
    case 'scroll':
    case 'drag':
    case 'wait':
      return value;
    default:
      return null;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
