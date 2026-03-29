import fs from 'node:fs';
import path from 'node:path';
import demoTargets from '../../../configs/demo-targets.json' with { type: 'json' };
import {
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
  const mode = (readFlag(args, '--mode') ?? process.env.WINDOWS_BROKER_MODE ?? 'mock') as RunMode;
  const target = (readFlag(args, '--target') ?? 'paint') as DemoTarget;
  if (target !== 'paint' && target !== 'calculator' && target !== 'any') {
    throw new Error(`Unsupported target: ${target}`);
  }

  const targetConfigs = demoTargets as Record<'paint' | 'calculator', DemoTargetConfig>;

  const targetAppFromFlag = readFlag(args, '--target-app') ?? readFlag(args, '--app');
  const isAnyTarget = target === 'any';
  const targetConfig = target === 'calculator' ? targetConfigs.calculator : targetConfigs.paint;
  const targetApp = isAnyTarget ? targetAppFromFlag : targetConfig.app;

  if (isAnyTarget && !targetApp) {
    throw new Error('When --target any is used, --target-app is required.');
  }

  const genericName = sanitizeName(targetApp ?? 'target-app');
  const outputDir =
    readFlag(args, '--output') ??
    (isAnyTarget ? path.join('artifacts', `custom-${genericName}`) : path.join(targetConfig.defaultOutputDir));
  const task =
    readFlag(args, '--task') ??
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
            targetApp: targetApp ?? 'target-app',
            reportPath: readFlag(args, '--report') ?? path.join('docs', 'reports', `custom-${genericName}-report.md`),
            launchCommand: readFlag(args, '--launch-command'),
            windowTitle: readFlag(args, '--window-title')
          });

  console.log(JSON.stringify(result, null, 2));
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

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function sanitizeName(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'target-app';
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
