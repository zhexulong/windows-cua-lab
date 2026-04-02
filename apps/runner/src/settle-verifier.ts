export type SemanticSettleState = 'success_like' | 'failure_like' | 'loading' | 'ambiguous';

export type SettleSample = {
  offsetMs: number;
  screenshotRef: string;
  changedPixelsFromBefore: number;
  changedBytesFromBefore: number;
  changedPixelsFromPrevious?: number;
  changedBytesFromPrevious?: number;
  semanticState?: SemanticSettleState;
  semanticSummary?: string;
  aiInvoked: boolean;
};

const DEFAULT_SETTLE_SAMPLE_OFFSETS_MS = [0, 250, 500, 1000, 1500] as const;
const PIXEL_GATE_MIN_CHANGED_PIXELS = 25;
const PIXEL_GATE_MIN_CHANGED_BYTES = 64;

/**
 * Assumes the 0ms frame was already captured and judged immediately after the action.
 * If settling is needed, this returns only follow-up offsets greater than 0.
 */
export function buildSettleSchedule(params: {
  firstSemanticState: SemanticSettleState;
  sampleOffsetsMs?: readonly number[];
}): { shouldSettle: boolean; offsetsMs: number[] } {
  const offsetsMs = [...(params.sampleOffsetsMs ?? DEFAULT_SETTLE_SAMPLE_OFFSETS_MS)];
  const shouldSettle = params.firstSemanticState === 'loading' || params.firstSemanticState === 'ambiguous';

  return {
    shouldSettle,
    offsetsMs: shouldSettle ? offsetsMs.filter((offsetMs) => offsetMs > 0) : []
  };
}

export function shouldInvokeSemanticJudge(params: {
  changedPixels: number;
  changedBytes: number;
  minChangedPixels?: number;
  minChangedBytes?: number;
}): boolean {
  const minChangedPixels = params.minChangedPixels ?? PIXEL_GATE_MIN_CHANGED_PIXELS;
  const minChangedBytes = params.minChangedBytes ?? PIXEL_GATE_MIN_CHANGED_BYTES;
  return params.changedPixels >= minChangedPixels || params.changedBytes >= minChangedBytes;
}

export function selectBestEvidenceSample(samples: readonly SettleSample[]): {
  winningSample?: SettleSample;
  finalStableSample?: SettleSample;
} {
  if (samples.length === 0) {
    return {};
  }

  const winningSample = [...samples].sort(compareEvidenceSamples)[0];
  const finalStableSample = samples[samples.length - 1];

  return {
    winningSample,
    finalStableSample
  };
}

function compareEvidenceSamples(left: SettleSample, right: SettleSample): number {
  return (
    scoreSample(right) - scoreSample(left)
    || right.changedBytesFromBefore - left.changedBytesFromBefore
    || right.changedPixelsFromBefore - left.changedPixelsFromBefore
    || right.offsetMs - left.offsetMs
  );
}

/**
 * Prefer terminal judgments over transitional ones: success/failure > ambiguous > loading > undefined.
 */
function scoreSample(sample: SettleSample): number {
  switch (sample.semanticState) {
    case 'success_like':
    case 'failure_like':
      return 3;
    case 'ambiguous':
      return 2;
    case 'loading':
      return 1;
    default:
      return 0;
  }
}
