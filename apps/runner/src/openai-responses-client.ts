export type ComputerToolDefinition = {
  type: 'computer';
};

export type ComputerScreenshotOutput = {
  type: 'computer_screenshot';
  image_url: string;
};

export type ComputerCallOutputEnvelope = {
  type: 'computer_call_output';
  call_id: string;
  status: 'completed' | 'failed';
  output: ComputerScreenshotOutput;
};

export function buildComputerToolDefinition(): ComputerToolDefinition {
  return {
    type: 'computer'
  };
}

export function buildComputerScreenshotOutput(pngBase64: string): ComputerScreenshotOutput {
  return {
    type: 'computer_screenshot',
    image_url: `data:image/png;base64,${pngBase64}`
  };
}

export function buildComputerCallOutputEnvelope(input: {
  callId: string;
  pngBase64: string;
  status?: 'completed' | 'failed';
}): ComputerCallOutputEnvelope {
  return {
    type: 'computer_call_output',
    call_id: input.callId,
    status: input.status ?? 'completed',
    output: buildComputerScreenshotOutput(input.pngBase64)
  };
}
