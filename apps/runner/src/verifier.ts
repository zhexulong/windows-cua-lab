import { BrokerAction, SafetyEvent, VerificationResult, countBufferDifferences } from './traces.js';

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
  const status: VerificationResult['status'] = changedBytes > 0 ? 'passed' : 'failed';
  const summary =
    status === 'passed'
      ? `Detected ${changedBytes} changed bytes after ${params.action.kind}.`
      : `No visible screenshot change detected after ${params.action.kind}.`;

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
      reason: status === 'passed' ? 'Visible state change observed.' : 'No visible state change observed.',
      policyRefs: ['visual-verification']
    }
  };
}
