import type { BrokerAction } from './traces.js';
import { buildComputerCallOutputEnvelope } from './openai-responses-client.js';

type ComputerCallExtractionResult =
  | { ok: true; callId: string; action: unknown }
  | { ok: false; failureKind: 'empty_completion' | 'shape_mismatch'; message: string };

type BrokerScreenshotArtifact = {
  kind?: string;
  ref?: string;
  contentBase64?: string;
};

type BrokerScreenshotResponse = {
  artifacts?: BrokerScreenshotArtifact[];
};

type BrokerScreenshotContractReasonCode =
  | 'broker_screenshot_missing_artifact'
  | 'broker_screenshot_missing_ref'
  | 'broker_screenshot_missing_base64';

type BrokerScreenshotValidationFailure = {
  ok: false;
  failureKind: 'broker_screenshot_contract_violation';
  reasonCode: BrokerScreenshotContractReasonCode;
  message: string;
};

type BrokerScreenshotValidationSuccess = {
  ok: true;
  artifact: {
    kind: 'screenshot';
    ref: string;
    contentBase64: string;
  };
};

export type BrokerScreenshotValidationResult =
  | BrokerScreenshotValidationSuccess
  | BrokerScreenshotValidationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePoint(value: unknown, fieldName: string): { x: number; y: number } {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    throw new Error(`${fieldName} requires numeric x and y.`);
  }

  return {
    x: value.x,
    y: value.y
  };
}

export function buildComputerCallOutput(input: {
  callId: string;
  pngBase64: string;
  status?: 'completed' | 'failed';
}) {
  return buildComputerCallOutputEnvelope(input);
}

function createBrokerScreenshotValidationFailure(
  reasonCode: BrokerScreenshotContractReasonCode,
  message: string
): BrokerScreenshotValidationFailure {
  return {
    ok: false,
    failureKind: 'broker_screenshot_contract_violation',
    reasonCode,
    message
  };
}

export function validateBrokerScreenshotResponse(input: BrokerScreenshotResponse): BrokerScreenshotValidationResult {
  const artifact = input.artifacts?.find((entry) => entry.kind === 'screenshot');
  if (!artifact) {
    return createBrokerScreenshotValidationFailure(
      'broker_screenshot_missing_artifact',
      'Broker screenshot response did not include a screenshot artifact.'
    );
  }

  if (typeof artifact.ref !== 'string' || artifact.ref.length === 0) {
    return createBrokerScreenshotValidationFailure(
      'broker_screenshot_missing_ref',
      'Broker screenshot response did not include a screenshot ref.'
    );
  }

  if (typeof artifact.contentBase64 !== 'string' || artifact.contentBase64.length === 0) {
    return createBrokerScreenshotValidationFailure(
      'broker_screenshot_missing_base64',
      'Broker screenshot response did not include screenshot contentBase64.'
    );
  }

  return {
    ok: true,
    artifact: {
      kind: 'screenshot',
      ref: artifact.ref,
      contentBase64: artifact.contentBase64
    }
  };
}

export function createBrokerScreenshotContractError(failure: BrokerScreenshotValidationFailure): Error & {
  code: 'broker_screenshot_contract_violation';
  reasonCode: BrokerScreenshotContractReasonCode;
} {
  const error = new Error(failure.message) as Error & {
    code: 'broker_screenshot_contract_violation';
    reasonCode: BrokerScreenshotContractReasonCode;
  };
  error.name = 'BrokerScreenshotContractError';
  error.code = failure.failureKind;
  error.reasonCode = failure.reasonCode;
  return error;
}

export function parseOpenAiComputerAction(input: unknown): BrokerAction {
  if (!isRecord(input) || typeof input.type !== 'string') {
    throw new Error('Computer action payload must be an object with a type field.');
  }

  switch (input.type) {
    case 'screenshot':
      return {
        kind: 'screenshot',
        scope: 'window'
      };
    case 'click':
      return {
        kind: 'click',
        position: {
          x: typeof input.x === 'number' ? input.x : parsePoint(input.position, 'click position').x,
          y: typeof input.y === 'number' ? input.y : parsePoint(input.position, 'click position').y,
        },
        button: input.button === 'right' || input.button === 'middle' || input.button === 'left' ? input.button : 'left'
      };
    case 'double_click':
      return {
        kind: 'double_click',
        position: {
          x: typeof input.x === 'number' ? input.x : parsePoint(input.position, 'double_click position').x,
          y: typeof input.y === 'number' ? input.y : parsePoint(input.position, 'double_click position').y,
        },
        button: input.button === 'right' || input.button === 'middle' || input.button === 'left' ? input.button : 'left'
      };
    case 'type':
      if (typeof input.text !== 'string' || input.text.length === 0) {
        throw new Error('Type action requires non-empty text.');
      }
      return {
        kind: 'type',
        text: input.text
      };
    case 'keypress':
      if (!Array.isArray(input.keys) || input.keys.length === 0 || !input.keys.every((key) => typeof key === 'string')) {
        throw new Error('Keypress action requires a non-empty string keys array.');
      }
      return {
        kind: 'keypress',
        keys: input.keys
      };
    case 'move': {
      const position = typeof input.x === 'number' && typeof input.y === 'number'
        ? { x: input.x, y: input.y }
        : parsePoint(input.position, 'move position');
      return {
        kind: 'move',
        position
      };
    }
    case 'scroll': {
      const position = typeof input.x === 'number' && typeof input.y === 'number'
        ? { x: input.x, y: input.y }
        : undefined;
      if (input.delta_x !== undefined && typeof input.delta_x !== 'number') {
        throw new Error('Scroll action delta_x must be numeric when provided.');
      }
      if (input.delta_y !== undefined && typeof input.delta_y !== 'number') {
        throw new Error('Scroll action delta_y must be numeric when provided.');
      }
      if (typeof input.delta_x !== 'number' && typeof input.delta_y !== 'number') {
        throw new Error('Scroll action requires at least one numeric delta_x or delta_y.');
      }
      return {
        kind: 'scroll',
        position,
        delta_x: typeof input.delta_x === 'number' ? input.delta_x : 0,
        delta_y: typeof input.delta_y === 'number' ? input.delta_y : 0,
        keys: Array.isArray(input.keys) && input.keys.every((key) => typeof key === 'string') ? input.keys : undefined
      };
    }
    case 'drag': {
      if (!Array.isArray(input.path) || input.path.length < 2) {
        throw new Error('Drag action requires a path with at least two points.');
      }
      return {
        kind: 'drag',
        from: parsePoint(input.path[0], 'drag start'),
        to: parsePoint(input.path[input.path.length - 1], 'drag end')
      };
    }
    case 'wait':
      return {
        kind: 'wait'
      };
    default:
      throw new Error(`Unsupported computer action type: ${input.type}`);
  }
}

export function extractComputerCallFromPayload(payload: unknown): ComputerCallExtractionResult {
  if (!isRecord(payload)) {
    return {
      ok: false,
      failureKind: 'shape_mismatch',
      message: 'AI payload is not an object.'
    };
  }

  const output = payload.output;
  if (!Array.isArray(output) || output.length === 0) {
    return {
      ok: false,
      failureKind: 'empty_completion',
      message: 'AI payload did not include any output items.'
    };
  }

  for (const item of output) {
    if (!isRecord(item) || item.type !== 'computer_call' || typeof item.call_id !== 'string') {
      continue;
    }

    if (!isRecord(item.action)) {
      return {
        ok: false,
        failureKind: 'shape_mismatch',
        message: 'AI payload computer_call item did not include a valid action object.'
      };
    }

    const action = item.action;
    return {
      ok: true,
      callId: item.call_id,
      action
    };
  }

  return {
    ok: false,
    failureKind: 'shape_mismatch',
    message: 'AI payload output did not include a computer_call item.'
  };
}
