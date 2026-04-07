import type { GenericPlannerContext } from './generic-planner-constraints.js';

export function buildGenericPlannerInstruction(params: { targetApp: string; task: string; plannerContext?: GenericPlannerContext; rejectionReason?: string }): string {
  return [
    'You are planning one bounded action for a Windows desktop app.',
    `Target app: ${params.targetApp}`,
    `Task: ${params.task}`,
    params.plannerContext ? 'Structured planner context (JSON):' : undefined,
    params.plannerContext ? JSON.stringify(params.plannerContext, null, 2) : undefined,
    params.rejectionReason ? `Previous candidate rejected because: ${params.rejectionReason}` : undefined,
    'Return JSON only with this shape:',
    '{"summary":"...","action":{"kind":"click|double_click|type|keypress|move|scroll|drag|wait","target":"string","button":"left|right|middle","position":{"x":number,"y":number},"text":"string","keys":["CTRL","S"],"delta_x":number,"delta_y":number,"from":{"x":number,"y":number},"to":{"x":number,"y":number}}}',
    'Only include fields required by the selected action kind.',
    'One action only. Avoid file system operations and destructive actions.',
    'Prefer actions that create a clear, visible, and verifiable UI change after one step.',
    'Prefer tool switches, panel toggles, tab changes, dialog opens, or obvious selection highlights.',
    'When the task indicates a previous pass already selected or focused a plausible target, prefer reusing that same target for bounded re-activation before switching to unrelated app-level actions.',
    'Prefer mouse-based re-activation on the same target before app-level activation like Enter when both are plausible.',
    'Allow app-level activation actions such as Enter when they continue the same entry goal.',
    'Avoid unrelated global app-level actions or keypresses that do not continue the same entry goal.',
    'Prefer reversible actions when possible.',
    'Avoid low-information actions such as color swatch clicks, weak hover effects, or subtle changes that are hard to verify from screenshots alone.',
  ].filter(Boolean).join('\n');
}
