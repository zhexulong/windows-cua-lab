import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PAINT_TASK, runPaintDemo } from './loop.js';
import { RunMode } from './traces.js';

async function main(): Promise<void> {
  loadEnvFiles(['.env.local', '.env']);

  const args = process.argv.slice(2);
  const mode = (readFlag(args, '--mode') ?? process.env.WINDOWS_BROKER_MODE ?? 'mock') as RunMode;
  const outputDir = readFlag(args, '--output') ?? path.join('artifacts', 'stage2-paint');
  const task = readFlag(args, '--task') ?? DEFAULT_PAINT_TASK;

  if (mode !== 'mock' && mode !== 'real') {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const result = await runPaintDemo({
    mode,
    outputDir,
    task,
    aiBaseUrl: process.env.URL,
    aiKey: process.env.KEY,
    brokerEndpoint: process.env.WINDOWS_BROKER_ENDPOINT,
    brokerApiKey: process.env.WINDOWS_BROKER_API_KEY,
    startBrokerIfNeeded: process.env.WINDOWS_BROKER_START !== 'false'
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
