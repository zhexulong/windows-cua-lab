export function buildGenericPlannerInstruction(params: { targetApp: string; task: string }): string {
  return [
    'You are planning one bounded action for a Windows desktop app.',
    `Target app: ${params.targetApp}`,
    `Task: ${params.task}`,
    'Return JSON only with this shape:',
    '{"summary":"...","action":{"kind":"click|type|hotkey|drag","target":"string","button":"left|right|middle","position":{"x":number,"y":number},"text":"string","keys":["CTRL","S"],"from":{"x":number,"y":number},"to":{"x":number,"y":number}}}',
    'Only include fields required by the selected action kind.',
    'One action only. Avoid file system operations and destructive actions.',
    'Prefer actions that create a clear, visible, and verifiable UI change after one step.',
    'Prefer tool switches, panel toggles, tab changes, dialog opens, or obvious selection highlights.',
    'Prefer reversible actions when possible.',
    'Avoid low-information actions such as color swatch clicks, weak hover effects, or subtle changes that are hard to verify from screenshots alone.',
  ].join('\n');
}
