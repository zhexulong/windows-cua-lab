import type { BrokerAction } from './traces.js';

export type StructuredBounds = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type StructuredRegionHint = {
  label?: string;
  bounds?: StructuredBounds;
};

export type StructuredVisualTarget = {
  text?: string;
  description?: string;
  nearText?: string;
};

export type StructuredWaitCondition = {
  type?: string;
  text?: string;
  titleSubstring?: string;
};

export type StructuredRunnerOperation = {
  toolName?: string;
  actionKind?: string;
  target?: StructuredVisualTarget;
  sourceTarget?: StructuredVisualTarget;
  destinationTarget?: StructuredVisualTarget;
  text?: string;
  clearFirst?: boolean;
  keys?: string[];
  deltaX?: number;
  deltaY?: number;
  snapshotRef?: string;
  regionHint?: StructuredRegionHint;
  sourceRegionHint?: StructuredRegionHint;
  destinationRegionHint?: StructuredRegionHint;
  condition?: StructuredWaitCondition;
};

export type GenericPlannerContext = {
  structured_request?: {
    intent?: string;
    action_kind?: string;
    target_summary?: string;
    expected_outcome?: string;
    observation_binding?: string;
  };
  second_pass_context?: {
    original_goal?: string;
    previous_target_ref?: string;
    previous_action_kind?: string;
    likely_failure_mode?: string;
    preferred_target_continuity?: boolean;
    allow_app_level_activation?: boolean;
      reject_unrelated_global_actions?: boolean;
      tool_inventory?: string[];
    };
  operation?: StructuredRunnerOperation;
};

export function validateGenericPlannerAction(
  action: BrokerAction,
  targetApp: string,
  plannerContext?: GenericPlannerContext,
): string | undefined {
  const context = plannerContext?.second_pass_context;
  if (!context) {
    return undefined;
  }

  if (context.tool_inventory?.length) {
    const availableTools = new Set(context.tool_inventory);
    if (!availableTools.has(action.kind)) {
      return `Planner action kind ${action.kind} is not available in the current second-pass tool inventory.`;
    }
  }

  if (context.preferred_target_continuity && context.previous_target_ref) {
    const target = (action.target ?? '').toLowerCase();
    const targetAppNormalized = targetApp.toLowerCase();
    const preferredTarget = context.previous_target_ref.toLowerCase();
    const preferredKeywords = extractContinuityKeywords(preferredTarget);

    const allowedAppLevelActivation = action.kind === 'keypress'
      && context.allow_app_level_activation
      && (target === targetAppNormalized || target === 'target-app');

    if (context.reject_unrelated_global_actions && !allowedAppLevelActivation && (target === targetAppNormalized || target === 'target-app')) {
      return 'Planner action violates second-pass target continuity by falling back to a global app-level target.';
    }

    if (action.kind !== 'keypress') {
      const matchesPreferredTarget = target.includes(preferredTarget)
        || preferredKeywords.some((keyword) => target.includes(keyword));

      if (!matchesPreferredTarget) {
        return 'Planner action violates second-pass target continuity because it does not reuse the previously selected target.';
      }
    }
  }

  return undefined;
}

function extractContinuityKeywords(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[^a-z0-9.]+/i)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length >= 3 && token !== 'host' && token !== 'card' && token !== 'selected'),
  ));
}
