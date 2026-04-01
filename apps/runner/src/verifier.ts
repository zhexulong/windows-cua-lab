import { BrokerAction, SafetyEvent, VerificationResult, countBufferDifferences, countPngPixelDifferences } from './traces.js';

const MIN_MEANINGFUL_PIXEL_DIFFERENCES = 25;

export interface VerificationTraceEntry {
  timestamp: string;
  method: string;
  changedBytes: number;
  actionKind: BrokerAction['kind'];
  status: VerificationResult['status'];
  summary: string;
}

export function verifyPaintStep(params: {
  beforeScreenshot: Buffer;
  afterScreenshot: Buffer;
  action: BrokerAction;
  beforeRef: string;
  afterRef: string;
}): {
  verification: VerificationResult;
  traceEntry: VerificationTraceEntry;
  safetyEvent: SafetyEvent;
} {
  const changedBytes = countBufferDifferences(params.beforeScreenshot, params.afterScreenshot);
  const changedPixels = countPngPixelDifferences(params.beforeScreenshot, params.afterScreenshot);
  const status: VerificationResult['status'] = changedPixels >= MIN_MEANINGFUL_PIXEL_DIFFERENCES ? 'passed' : 'failed';
  const summary =
    status === 'passed'
      ? `Detected ${changedPixels} changed pixels (${changedBytes} changed bytes) after ${params.action.kind}.`
      : `No meaningful visible screenshot change detected after ${params.action.kind}; only ${changedPixels} pixels changed (${changedBytes} changed bytes).`;

  return {
    verification: {
      status,
      method: 'binary-image-diff',
      summary,
      evidenceRefs: [params.beforeRef, params.afterRef]
    },
    traceEntry: {
      timestamp: new Date().toISOString(),
      method: 'binary-image-diff',
      changedBytes,
      actionKind: params.action.kind,
      status,
      summary
    },
    safetyEvent: {
      decision: status === 'passed' ? 'allowed' : 'review_required',
      reason:
        status === 'passed'
          ? 'Meaningful visible state change observed.'
          : 'No meaningful visible state change observed.',
      policyRefs: ['visual-verification']
    }
  };
}

export function verifyCalculatorStep(params: {
  beforeScreenshot: Buffer;
  afterScreenshot: Buffer;
  action: BrokerAction;
  beforeRef: string;
  afterRef: string;
  expectedResult: string;
  actualResult: string;
}): {
  verification: VerificationResult;
  traceEntry: VerificationTraceEntry;
  safetyEvent: SafetyEvent;
} {
  const changedBytes = countBufferDifferences(params.beforeScreenshot, params.afterScreenshot);
  const stateChanged = changedBytes > 0;
  const resultMatched = params.actualResult.trim() === params.expectedResult.trim();
  const status: VerificationResult['status'] = stateChanged && resultMatched ? 'passed' : 'failed';
  const summary =
    status === 'passed'
      ? `Calculator display matched expected result ${params.expectedResult} after ${params.action.kind}.`
      : `Calculator verification failed: expected ${params.expectedResult}, read ${params.actualResult}, changedBytes=${changedBytes}.`;

  return {
    verification: {
      status,
      method: 'calculator-deterministic-read',
      summary,
      evidenceRefs: [params.beforeRef, params.afterRef]
    },
    traceEntry: {
      timestamp: new Date().toISOString(),
      method: 'calculator-deterministic-read',
      changedBytes,
      actionKind: params.action.kind,
      status,
      summary
    },
    safetyEvent: {
      decision: status === 'passed' ? 'allowed' : 'review_required',
      reason:
        status === 'passed'
          ? `Deterministic calculator result ${params.actualResult} matched expectation.`
          : `Deterministic calculator read mismatch: expected ${params.expectedResult}, got ${params.actualResult}.`,
      policyRefs: ['calculator-deterministic-read']
    }
  };
}
