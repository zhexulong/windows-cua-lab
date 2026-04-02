import type { BrokerAction } from './traces.js';

export type GenericPlannerContext = {
  second_pass_context?: {
    original_goal?: string;
    previous_target_ref?: string;
    previous_action_kind?: string;
    likely_failure_mode?: string;
    preferred_target_continuity?: boolean;
    allow_app_level_activation?: boolean;
    reject_unrelated_global_actions?: boolean;
    allowed_next_action_kinds?: string[];
    allowed_hotkeys?: string[];
  };
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

  if (context.allowed_next_action_kinds?.length) {
    const allowedKinds = new Set(context.allowed_next_action_kinds);
    if (!allowedKinds.has(action.kind)) {
      return `Planner action kind ${action.kind} is not allowed for this second pass.`;
    }
  }

  if (action.kind === 'hotkey' && context.allowed_hotkeys?.length) {
    const normalizedKeys = (action.keys ?? []).map((key) => key.toUpperCase());
    const allowedHotkeys = context.allowed_hotkeys.map((key) => key.toUpperCase());
    const allowedSingleHotkey = normalizedKeys.length === 1 && allowedHotkeys.includes(normalizedKeys[0] ?? '');
    if (!allowedSingleHotkey) {
      return 'Planner action violates second-pass target continuity by selecting a disallowed hotkey.';
    }
  }

  if (context.preferred_target_continuity && context.previous_target_ref) {
    const target = (action.target ?? '').toLowerCase();
    const targetAppNormalized = targetApp.toLowerCase();
    const preferredTarget = context.previous_target_ref.toLowerCase();
    const preferredKeywords = extractContinuityKeywords(preferredTarget);

    const allowedAppLevelActivation = action.kind === 'hotkey'
      && context.allow_app_level_activation
      && (target === targetAppNormalized || target === 'target-app');

    if (context.reject_unrelated_global_actions && !allowedAppLevelActivation && (target === targetAppNormalized || target === 'target-app')) {
      return 'Planner action violates second-pass target continuity by falling back to a global app-level target.';
    }

    if (action.kind !== 'hotkey') {
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
