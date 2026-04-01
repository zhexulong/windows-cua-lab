import type { BrokerAction, ClickAction, DragAction } from './traces.js';

export function selectHigherInformationGenericAction(input: {
  targetApp: string;
  summary: string;
  action: BrokerAction;
}): { summary: string; action: BrokerAction } {
  if (shouldReplaceWithPaintCanvasDrag(input.targetApp, input.action)) {
    return {
      summary: `${input.summary} Replaced with a higher-information reversible canvas drag probe for Paint because palette-color clicks are often too subtle to verify reliably.`,
      action: createHighInformationPaintDrag(),
    };
  }

  return input;
}

function shouldReplaceWithPaintCanvasDrag(targetApp: string, action: BrokerAction): action is ClickAction {
  if (targetApp.toLowerCase() !== 'mspaint.exe') {
    return false;
  }

  if (action.kind !== 'click') {
    return false;
  }

  const target = (action.target ?? '').toLowerCase();
  return target.includes('color') || target.includes('swatch') || target.includes('palette');
}

function createHighInformationPaintDrag(): DragAction {
  return {
    kind: 'drag',
    from: { x: 320, y: 260 },
    to: { x: 420, y: 320 },
    target: 'paint-canvas',
  };
}
