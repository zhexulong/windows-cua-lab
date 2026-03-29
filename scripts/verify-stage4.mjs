import fs from 'node:fs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const reportPath = 'docs/reports/stage-4-reusable-capability-export.md';
const schemaPath = 'schemas/reusable-state-summary.json';
const readmePath = 'README.md';

if (!fs.existsSync(reportPath)) {
  fail(`Missing Stage 4 report: ${reportPath}`);
}

if (!fs.existsSync(schemaPath)) {
  fail(`Missing reusable state summary schema: ${schemaPath}`);
}

const report = fs.readFileSync(reportPath, 'utf8');
const readme = fs.readFileSync(readmePath, 'utf8');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

for (const phrase of [
  'transition envelope',
  'replay trace',
  'state summary',
  'safety event log',
  'Vibe-Building-Your-Own-X'
]) {
  if (!report.toLowerCase().includes(phrase.toLowerCase())) {
    fail(`Stage 4 report must describe ${phrase}`);
  }
}

if (!readme.includes('Reusable export contract')) {
  fail('README must document the reusable export contract section');
}

if (!schema.$id || !String(schema.$id).includes('reusable-state-summary.json')) {
  fail('Stage 4 schema must declare a reusable-state-summary $id');
}

const required = new Set(Array.isArray(schema.required) ? schema.required : []);
for (const field of ['stateLabel', 'confidence', 'status', 'evidenceRefs']) {
  if (!required.has(field)) {
    fail(`Reusable state summary schema must require ${field}`);
  }
}

const replaySchema = JSON.parse(fs.readFileSync('schemas/replay-trace.json', 'utf8'));
const safetyItems = replaySchema.properties?.safetyEvents?.items;
const safetyRule = JSON.stringify(safetyItems);
if (!safetyRule.includes('blocked') || !safetyRule.includes('review_required') || !safetyRule.includes('reason')) {
  fail('Replay trace schema must require a reason for blocked or review_required safety events');
}

for (const phrase of ['what remains lab-only', 'decoupling rules', 'consumption sketch']) {
  if (!report.toLowerCase().includes(phrase)) {
    fail(`Stage 4 report must include ${phrase}`);
  }
}

console.log('Verified Stage 4 export contract artifacts');
