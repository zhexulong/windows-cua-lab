import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const outputDir = process.argv[2] ?? 'artifacts/stage3-calculator';
const replayTracePath = path.join(outputDir, 'replay-trace.json');
const actionTracePath = path.join(outputDir, 'action-trace.jsonl');
const verifierTracePath = path.join(outputDir, 'verifier-trace.jsonl');
const reportPath = path.join('docs', 'reports', 'stage-3-calculator-validation.md');

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

if (!fs.existsSync(reportPath)) {
  fail(`Missing Stage 3 report: ${reportPath}`);
}

const replayTrace = JSON.parse(fs.readFileSync(replayTracePath, 'utf8'));
if (!Array.isArray(replayTrace.steps) || replayTrace.steps.length < 1) {
  fail('Replay trace must contain at least one calculator transition');
}

const step = replayTrace.steps[0];
if (step.verification?.status !== 'passed') {
  fail('Calculator verification must pass');
}

const expectedNote = notesFromStep(step).find((note) => typeof note === 'string' && note.startsWith('expected-result:'));
const actualNote = notesFromStep(step).find((note) => typeof note === 'string' && note.startsWith('deterministic-result:'));
const expectedResult = expectedNote?.slice('expected-result:'.length);
const actualResult = actualNote?.slice('deterministic-result:'.length);

if (!expectedResult || !actualResult) {
  fail('Calculator transition must include expected-result and deterministic-result notes');
}

const verifierEntries = fs
  .readFileSync(verifierTracePath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const hasDeterministicVerifierEntry = verifierEntries.some(
  (entry) => entry.method === 'calculator-deterministic-read' && entry.status === 'passed'
);
if (!hasDeterministicVerifierEntry) {
  fail('Expected a passed calculator-deterministic-read verifier entry');
}

const actions = fs
  .readFileSync(actionTracePath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const executedActions = actions.filter((action) => action.status === 'executed');
if (executedActions.length < 1) {
  fail('Expected at least one executed action in calculator action trace');
}

const reportText = fs.readFileSync(reportPath, 'utf8');
if (!reportText.includes('- Verification passed: yes')) {
  fail('Stage 3 report must record a passing verification outcome');
}

if (!reportText.includes(`- Expected result: ${expectedResult}`)) {
  fail(`Stage 3 report must include expected result ${expectedResult}`);
}

if (!reportText.includes(`- Actual result: ${actualResult}`)) {
  fail(`Stage 3 report must include actual result ${actualResult}`);
}

console.log(`Verified Stage 3 artifacts in ${outputDir}`);

function notesFromStep(step) {
  return Array.isArray(step.notes) ? step.notes : [];
}
