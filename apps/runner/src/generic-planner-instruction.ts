import type { GenericPlannerContext } from './generic-planner-constraints.js';

function normalizeStructuredRequestForPrompt(plannerContext?: GenericPlannerContext): Record<string, unknown> | undefined {
  const structuredRequest = plannerContext?.structured_request;
  if (!structuredRequest) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries({
      intent: structuredRequest.intent,
      action_kind: structuredRequest.action_kind,
      target_summary: structuredRequest.target_summary,
      expected_outcome: structuredRequest.expected_outcome,
      observation_binding: structuredRequest.observation_binding,
    }).filter(([, value]) => value !== undefined && value !== null),
  );
}

function buildObjectivePromptLines(params: { objectiveText: string; plannerContext?: GenericPlannerContext }): string[] {
  const normalizedStructuredRequest = normalizeStructuredRequestForPrompt(params.plannerContext);
  if (!normalizedStructuredRequest) {
    return [`Objective summary: ${params.objectiveText}`];
  }

  return [
    'Structured request (normalized JSON):',
    JSON.stringify(normalizedStructuredRequest, null, 2),
    'Treat the structured request as authoritative.',
    'Use the auxiliary objective summary only as a fallback gloss.',
    `Auxiliary objective summary: ${params.objectiveText}`,
  ];
}

export function resolveGenericPlannerObjectiveText(params: { targetApp: string; task?: string; plannerContext?: GenericPlannerContext }): string {
  if (params.task?.trim()) {
    return params.task.trim();
  }

  const structuredRequest = params.plannerContext?.structured_request;
  if (structuredRequest) {
    return [
      'Perform one bounded action',
      structuredRequest.action_kind ? `using ${structuredRequest.action_kind}` : undefined,
      structuredRequest.target_summary ? `against ${structuredRequest.target_summary}` : undefined,
      structuredRequest.expected_outcome ? `so that ${structuredRequest.expected_outcome}` : undefined,
    ].filter(Boolean).join(' ');
  }

  return `Perform one bounded action in ${params.targetApp}.`;
}

export function buildGenericPlannerInstruction(params: { targetApp: string; task?: string; plannerContext?: GenericPlannerContext; rejectionReason?: string }): string {
  const availableTools = params.plannerContext?.second_pass_context?.tool_inventory?.join(', ');
  const objectiveText = resolveGenericPlannerObjectiveText(params);
  return [
    'You are planning one bounded action for a Windows desktop app.',
    `Target app: ${params.targetApp}`,
    ...buildObjectivePromptLines({ objectiveText, plannerContext: params.plannerContext }),
    params.plannerContext ? 'Structured planner context (JSON):' : undefined,
    params.plannerContext ? JSON.stringify(params.plannerContext, null, 2) : undefined,
    availableTools ? `Available tools: ${availableTools}` : undefined,
    params.rejectionReason ? `Previous candidate rejected because: ${params.rejectionReason}` : undefined,
    'Return JSON only with this shape:',
    '{"summary":"...","action":{"kind":"click|double_click|type|keypress|move|scroll|drag|wait","target":"string","button":"left|right|middle","position":{"x":number,"y":number},"text":"string","keys":["CTRL","S"],"delta_x":number,"delta_y":number,"from":{"x":number,"y":number},"to":{"x":number,"y":number}}}',
    'Only include fields required by the selected action kind.',
    'One action only. Avoid file system operations and destructive actions.',
    'Prefer actions that create a clear, visible, and verifiable UI change after one step.',
    'Prefer tool switches, panel toggles, tab changes, dialog opens, or obvious selection highlights.',
    'When the task indicates a previous pass already selected or focused a plausible target, prefer reusing that same target for bounded re-activation before switching to unrelated app-level actions.',
    'Allow app-level activation actions such as Enter when they continue the same entry goal.',
    'Avoid unrelated global app-level actions or keypresses that do not continue the same entry goal.',
    'Prefer reversible actions when possible.',
    'Avoid low-information actions such as color swatch clicks, weak hover effects, or subtle changes that are hard to verify from screenshots alone.',
  ].filter(Boolean).join('\n');
}

export function buildGenericVerifierInstruction(params: {
  targetApp: string;
  task?: string;
  plannerContext?: GenericPlannerContext;
  actionKind: string;
  offsetMs: number;
}): string {
  const objectiveText = resolveGenericPlannerObjectiveText(params);
  return [
    `You are verifying one bounded UI action in ${params.targetApp}.`,
    ...buildObjectivePromptLines({ objectiveText, plannerContext: params.plannerContext }),
    `Action kind: ${params.actionKind}`,
    `Candidate screenshot offset: ${params.offsetMs}ms after the action.`,
    'Compare the before screenshot to the candidate screenshot.',
    'Return JSON only with this shape:',
    '{"semanticState":"success_like|failure_like|loading|ambiguous","summary":"..."}',
    'Use success_like only when the candidate clearly shows the action advanced to a more complete target scene.',
    'Use failure_like for clearly blocked, errored, or wrong-result states.',
    'Use loading for transitional states such as connecting, loading, spinning, or partially entered views.',
    'Use ambiguous when the candidate changed but the destination state is still unclear.',
    'Be conservative and summarize the visible state, not a guess about hidden intent.'
  ].filter(Boolean).join('\n');
}
