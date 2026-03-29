import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

export type RunMode = 'mock' | 'real';
export type Provenance = 'computer_use' | 'native_adapter' | 'hybrid';

export interface Point {
  x: number;
  y: number;
}

interface BaseAction {
  kind: 'screenshot' | 'click' | 'type' | 'hotkey' | 'drag';
  target?: string;
}

export interface ScreenshotAction extends BaseAction {
  kind: 'screenshot';
  scope: 'desktop' | 'window' | 'region';
}

export interface ClickAction extends BaseAction {
  kind: 'click';
  button: 'left' | 'right' | 'middle';
  position: Point;
}

export interface TypeAction extends BaseAction {
  kind: 'type';
  text: string;
}

export interface HotkeyAction extends BaseAction {
  kind: 'hotkey';
  keys: string[];
}

export interface DragAction extends BaseAction {
  kind: 'drag';
  from: Point;
  to: Point;
}

export type BrokerAction = ScreenshotAction | ClickAction | TypeAction | HotkeyAction | DragAction;

export interface StateHandle {
  screenshotRef: string;
  windowRef?: string;
  stateLabel?: string;
  evidenceRefs?: string[];
}

export interface VerificationResult {
  status: 'passed' | 'failed' | 'unknown';
  method?: string;
  summary?: string;
  evidenceRefs?: string[];
}

export interface SafetyEvent {
  decision: 'allowed' | 'blocked' | 'review_required';
  reason?: string;
  policyRefs?: string[];
}

export interface TransitionEnvelope {
  transitionId: string;
  timestamp: string;
  provenance: Provenance;
  action: BrokerAction;
  before: StateHandle;
  after: StateHandle;
  verification: VerificationResult;
  safetyEvent: SafetyEvent;
  notes?: string[];
}

export interface ReplayTrace {
  traceId: string;
  sessionId: string;
  createdAt: string;
  target: {
    app: string;
    environment: 'windows-desktop';
    operatorPlane: 'wsl';
  };
  artifacts: {
    screenshots: string[];
    actionTrace: string;
    verifierTrace: string;
    summaryReport: string;
  };
  steps: TransitionEnvelope[];
  summary: {
    status: 'completed' | 'failed' | 'blocked' | 'partial';
    stepCount: number;
    verificationPassed?: boolean;
    notes?: string[];
  };
  safetyEvents: Array<{
    decision: SafetyEvent['decision'];
    reason?: string;
    transitionId?: string;
  }>;
}

export interface TracePaths {
  outputDir: string;
  screenshotsDir: string;
  actionTracePath: string;
  verifierTracePath: string;
  replayTracePath: string;
  reportPath: string;
}

export interface PixelCanvas {
  width: number;
  height: number;
  pixels: number[][][];
}

const CRC_TABLE = (() => {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table.push(value >>> 0);
  }
  return table;
})();

export const WINDOWS_FILE_SANDBOX_ROOT = 'E:\\projects\\desktop-discovery-lab-temp';

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

export async function ensureTracePaths(outputDir: string): Promise<TracePaths> {
  const screenshotsDir = path.join(outputDir, 'screenshots');
  await fs.mkdir(screenshotsDir, { recursive: true });
  await fs.mkdir(path.join('docs', 'reports'), { recursive: true });

  return {
    outputDir,
    screenshotsDir,
    actionTracePath: path.join(outputDir, 'action-trace.jsonl'),
    verifierTracePath: path.join(outputDir, 'verifier-trace.jsonl'),
    replayTracePath: path.join(outputDir, 'replay-trace.json'),
    reportPath: path.join('docs', 'reports', 'stage-2-paint-demo.md')
  };
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value, 'utf8');
}

export async function appendJsonLine(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

export function createPaintCanvas(width = 96, height = 72): PixelCanvas {
  const pixels = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => [255, 255, 255])
  );
  const canvas: PixelCanvas = { width, height, pixels };

  fillRect(canvas, 0, 0, width, 12, [240, 240, 240]);
  fillRect(canvas, 0, 12, 10, height - 12, [232, 232, 232]);
  fillRect(canvas, 12, 16, width - 18, height - 22, [255, 255, 255]);
  drawRect(canvas, 2, 2, 7, 7, [180, 180, 180]);
  drawRect(canvas, 14, 16, width - 19, height - 23, [210, 210, 210]);

  return canvas;
}

export function cloneCanvas(canvas: PixelCanvas): PixelCanvas {
  return {
    width: canvas.width,
    height: canvas.height,
    pixels: canvas.pixels.map((row) => row.map((pixel) => [...pixel]))
  };
}

export function applyActionToCanvas(canvas: PixelCanvas, action: BrokerAction): PixelCanvas {
  const next = cloneCanvas(canvas);
  switch (action.kind) {
    case 'drag': {
      drawLine(next, action.from, action.to, [29, 78, 216], 2);
      return next;
    }
    case 'click': {
      drawDot(next, action.position, [200, 35, 51], 2);
      return next;
    }
    case 'type': {
      drawRect(next, 24, 24, Math.min(72, 24 + action.text.length * 4), 32, [51, 51, 51]);
      return next;
    }
    default:
      return next;
  }
}

export async function writeScreenshot(tracePaths: TracePaths, filename: string, pngBuffer: Buffer): Promise<string> {
  const relativePath = path.join('screenshots', filename);
  await fs.writeFile(path.join(tracePaths.outputDir, relativePath), pngBuffer);
  return relativePath;
}

export function canvasToPngBuffer(canvas: PixelCanvas): Buffer {
  const scanlines: Buffer[] = [];
  for (const row of canvas.pixels) {
    const bytes = Buffer.alloc(1 + row.length * 3);
    bytes[0] = 0;
    row.forEach((pixel, index) => {
      const offset = 1 + index * 3;
      bytes[offset] = pixel[0] ?? 0;
      bytes[offset + 1] = pixel[1] ?? 0;
      bytes[offset + 2] = pixel[2] ?? 0;
    });
    scanlines.push(bytes);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(Buffer.concat(scanlines));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    createChunk('IHDR', ihdr),
    createChunk('IDAT', idat),
    createChunk('IEND', Buffer.alloc(0))
  ]);
}

export function countBufferDifferences(left: Buffer, right: Buffer): number {
  const limit = Math.max(left.length, right.length);
  let differences = 0;
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      differences += 1;
    }
  }
  return differences;
}

function fillRect(canvas: PixelCanvas, x1: number, y1: number, x2: number, y2: number, color: [number, number, number]): void {
  for (let y = Math.max(0, y1); y < Math.min(canvas.height, y2); y += 1) {
    for (let x = Math.max(0, x1); x < Math.min(canvas.width, x2); x += 1) {
      canvas.pixels[y]![x] = [...color];
    }
  }
}

function drawRect(canvas: PixelCanvas, x1: number, y1: number, x2: number, y2: number, color: [number, number, number]): void {
  for (let x = x1; x <= x2; x += 1) {
    setPixel(canvas, x, y1, color);
    setPixel(canvas, x, y2, color);
  }
  for (let y = y1; y <= y2; y += 1) {
    setPixel(canvas, x1, y, color);
    setPixel(canvas, x2, y, color);
  }
}

function drawLine(canvas: PixelCanvas, from: Point, to: Point, color: [number, number, number], thickness: number): void {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let index = 0; index <= steps; index += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * index) / Math.max(steps, 1));
    const y = Math.round(from.y + ((to.y - from.y) * index) / Math.max(steps, 1));
    drawDot(canvas, { x, y }, color, thickness);
  }
}

function drawDot(canvas: PixelCanvas, point: Point, color: [number, number, number], radius: number): void {
  for (let y = point.y - radius; y <= point.y + radius; y += 1) {
    for (let x = point.x - radius; x <= point.x + radius; x += 1) {
      const dx = x - point.x;
      const dy = y - point.y;
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(canvas, x, y, color);
      }
    }
  }
}

function setPixel(canvas: PixelCanvas, x: number, y: number, color: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    return;
  }
  canvas.pixels[y]![x] = [...color];
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);

  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(calculateCrc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function calculateCrc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}
