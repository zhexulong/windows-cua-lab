import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const outputDir = process.argv[2] ?? 'artifacts/stage2-paint';
const replayTracePath = path.join(outputDir, 'replay-trace.json');
const actionTracePath = path.join(outputDir, 'action-trace.jsonl');
const verifierTracePath = path.join(outputDir, 'verifier-trace.jsonl');
const screenshotsDir = path.join(outputDir, 'screenshots');
const reportPath = path.join('docs', 'reports', 'stage-2-paint-demo.md');

if (!fs.existsSync(outputDir)) {
  fail(`Missing output directory: ${outputDir}`);
}

if (!fs.existsSync(replayTracePath)) {
  fail(`Missing replay trace: ${replayTracePath}`);
}

if (!fs.existsSync(actionTracePath)) {
  fail(`Missing action trace: ${actionTracePath}`);
}

if (!fs.existsSync(verifierTracePath)) {
  fail(`Missing verifier trace: ${verifierTracePath}`);
}

if (!fs.existsSync(screenshotsDir)) {
  fail(`Missing screenshots directory: ${screenshotsDir}`);
}

const screenshotFiles = fs
  .readdirSync(screenshotsDir)
  .filter((file) => file.endsWith('.png'))
  .sort();

if (screenshotFiles.length < 2) {
  fail(`Expected at least two screenshots, found ${screenshotFiles.length}`);
}

const firstScreenshot = fs.readFileSync(path.join(screenshotsDir, screenshotFiles[0]));
const lastScreenshot = fs.readFileSync(path.join(screenshotsDir, screenshotFiles.at(-1)));

if (Buffer.compare(firstScreenshot, lastScreenshot) === 0) {
  fail('Expected screenshots to change across steps');
}

const actions = fs
  .readFileSync(actionTracePath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const executedActions = actions.filter((action) => action.status === 'executed');
if (executedActions.length < 1) {
  fail('Expected at least one executed action in action trace');
}

const replayTrace = JSON.parse(fs.readFileSync(replayTracePath, 'utf8'));

if (!Array.isArray(replayTrace.steps) || replayTrace.steps.length < 1) {
  fail('Replay trace must contain at least one step');
}

if (!Array.isArray(replayTrace.artifacts?.screenshots) || replayTrace.artifacts.screenshots.length < 2) {
  fail('Replay trace must reference multiple screenshots');
}

if (!fs.existsSync(reportPath)) {
  fail(`Missing Stage 2 report: ${reportPath}`);
}

console.log(`Verified Stage 2 artifacts in ${outputDir}`);
