import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import type { SemanticSettleState } from './settle-verifier.js';

export type RunMode = 'mock' | 'real';
export type Provenance = 'computer_use' | 'native_adapter' | 'hybrid';

export interface Point {
  x: number;
  y: number;
}

interface BaseAction {
  kind: 'screenshot' | 'click' | 'double_click' | 'type' | 'keypress' | 'move' | 'scroll' | 'drag' | 'wait';
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

export interface DoubleClickAction extends BaseAction {
  kind: 'double_click';
  button: 'left' | 'right' | 'middle';
  position: Point;
}

export interface TypeAction extends BaseAction {
  kind: 'type';
  text: string;
}

export interface KeypressAction extends BaseAction {
  kind: 'keypress';
  keys: string[];
}

export interface MoveAction extends BaseAction {
  kind: 'move';
  position: Point;
}

export interface ScrollAction extends BaseAction {
  kind: 'scroll';
  position?: Point;
  delta_x: number;
  delta_y: number;
  keys?: string[];
}

export interface DragAction extends BaseAction {
  kind: 'drag';
  from: Point;
  to: Point;
}

export interface WaitAction extends BaseAction {
  kind: 'wait';
}

export type BrokerAction =
  | ScreenshotAction
  | ClickAction
  | DoubleClickAction
  | TypeAction
  | KeypressAction
  | MoveAction
  | ScrollAction
  | DragAction
  | WaitAction;

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
  semanticState?: SemanticSettleState;
  winningScreenshotRef?: string;
  finalStableScreenshotRef?: string;
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
  computerUse?: {
    callId?: string;
    responseId?: string;
    previousResponseId?: string;
  };
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
    policyRefs?: string[];
  }>;
  computerUse?: {
    responseId?: string;
    previousResponseId?: string;
    outputRef?: string;
  };
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

export function createCalculatorCanvas(display: string, width = 120, height = 96): PixelCanvas {
  const pixels = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => [246, 246, 246])
  );
  const canvas: PixelCanvas = { width, height, pixels };

  fillRect(canvas, 0, 0, width, 18, [232, 232, 232]);
  fillRect(canvas, 12, 18, width - 12, 38, [255, 255, 255]);
  drawRect(canvas, 12, 18, width - 13, 38, [210, 210, 210]);

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const x1 = 14 + col * 32;
      const y1 = 46 + row * 12;
      fillRect(canvas, x1, y1, x1 + 24, y1 + 8, [224, 224, 224]);
      drawRect(canvas, x1, y1, x1 + 24, y1 + 8, [192, 192, 192]);
    }
  }

  drawDisplayDigits(canvas, display.slice(0, 8));
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
    case 'double_click': {
      drawDot(next, action.position, [200, 35, 51], 3);
      return next;
    }
    case 'move': {
      drawDot(next, action.position, [36, 120, 64], 1);
      return next;
    }
    case 'scroll': {
      const anchor = action.position ?? { x: Math.round(next.width / 2), y: Math.round(next.height / 2) };
      const direction = action.delta_y === 0 ? 1 : Math.sign(action.delta_y);
      drawLine(next, { x: anchor.x, y: anchor.y - 8 * direction }, { x: anchor.x, y: anchor.y + 8 * direction }, [120, 72, 180], 1);
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

export function countPngPixelDifferences(left: Buffer, right: Buffer): number {
  const leftImage = decodePngBuffer(left);
  const rightImage = decodePngBuffer(right);
  const width = Math.max(leftImage.width, rightImage.width);
  const height = Math.max(leftImage.height, rightImage.height);
  let differences = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const leftPixel = getDecodedPixel(leftImage, x, y);
      const rightPixel = getDecodedPixel(rightImage, x, y);
      if (
        leftPixel[0] !== rightPixel[0] ||
        leftPixel[1] !== rightPixel[1] ||
        leftPixel[2] !== rightPixel[2]
      ) {
        differences += 1;
      }
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

interface DecodedPngImage {
  width: number;
  height: number;
  channels: number;
  pixels: Buffer;
}

function decodePngBuffer(buffer: Buffer): DecodedPngImage {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < pngSignature.length || !buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error('Unsupported PNG buffer: invalid signature.');
  }

  let offset = pngSignature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlaceMethod = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    offset += 4;
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    offset += 4;
    const data = buffer.subarray(offset, offset + length);
    offset += length;
    offset += 4;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlaceMethod = data[12] ?? 0;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || !isSupportedPngColorType(colorType) || interlaceMethod !== 0) {
    throw new Error(`Unsupported PNG buffer: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlaceMethod}.`);
  }

  const channels = getPngColorChannels(colorType);
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(width * height * channels);
  let sourceOffset = 0;
  let priorRow = Buffer.alloc(stride, 0);

  for (let row = 0; row < height; row += 1) {
    const filterType = inflated[sourceOffset] ?? 0;
    sourceOffset += 1;
    const rowData = Buffer.from(inflated.subarray(sourceOffset, sourceOffset + stride));
    sourceOffset += stride;
    const decodedRow = unfilterPngRow(rowData, priorRow, filterType, channels);
    decodedRow.copy(pixels, row * stride);
    priorRow = Buffer.from(decodedRow);
  }

  return { width, height, channels, pixels };
}

function isSupportedPngColorType(colorType: number): boolean {
  return colorType === 2 || colorType === 6;
}

function getPngColorChannels(colorType: number): number {
  switch (colorType) {
    case 2:
      return 3;
    case 6:
      return 4;
    default:
      throw new Error(`Unsupported PNG color type: ${colorType}`);
  }
}

function unfilterPngRow(row: Buffer, priorRow: Buffer, filterType: number, bytesPerPixel: number): Buffer {
  const decoded = Buffer.alloc(row.length);
  switch (filterType) {
    case 0:
      row.copy(decoded);
      return decoded;
    case 1:
      for (let index = 0; index < row.length; index += 1) {
        const left = index >= bytesPerPixel ? decoded[index - bytesPerPixel] ?? 0 : 0;
        decoded[index] = ((row[index] ?? 0) + left) & 0xff;
      }
      return decoded;
    case 2:
      for (let index = 0; index < row.length; index += 1) {
        decoded[index] = ((row[index] ?? 0) + (priorRow[index] ?? 0)) & 0xff;
      }
      return decoded;
    case 3:
      for (let index = 0; index < row.length; index += 1) {
        const left = index >= bytesPerPixel ? decoded[index - bytesPerPixel] ?? 0 : 0;
        const up = priorRow[index] ?? 0;
        decoded[index] = ((row[index] ?? 0) + Math.floor((left + up) / 2)) & 0xff;
      }
      return decoded;
    case 4:
      for (let index = 0; index < row.length; index += 1) {
        const left = index >= bytesPerPixel ? decoded[index - bytesPerPixel] ?? 0 : 0;
        const up = priorRow[index] ?? 0;
        const upLeft = index >= bytesPerPixel ? priorRow[index - bytesPerPixel] ?? 0 : 0;
        decoded[index] = ((row[index] ?? 0) + paethPredictor(left, up, upLeft)) & 0xff;
      }
      return decoded;
    default:
      throw new Error(`Unsupported PNG filter type: ${filterType}`);
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }

  if (upDistance <= upLeftDistance) {
    return up;
  }

  return upLeft;
}

function getDecodedPixel(image: DecodedPngImage, x: number, y: number): [number, number, number] {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return [0, 0, 0];
  }

  const offset = (y * image.width + x) * image.channels;
  return [image.pixels[offset] ?? 0, image.pixels[offset + 1] ?? 0, image.pixels[offset + 2] ?? 0];
}

function calculateCrc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function drawDisplayDigits(canvas: PixelCanvas, display: string): void {
  const glyphs: Record<string, string[]> = {
    '0': ['111', '101', '101', '101', '111'],
    '1': ['010', '110', '010', '010', '111'],
    '2': ['111', '001', '111', '100', '111'],
    '3': ['111', '001', '111', '001', '111'],
    '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'],
    '6': ['111', '100', '111', '101', '111'],
    '7': ['111', '001', '001', '001', '001'],
    '8': ['111', '101', '111', '101', '111'],
    '9': ['111', '101', '111', '001', '111'],
    '+': ['000', '010', '111', '010', '000'],
    '-': ['000', '000', '111', '000', '000'],
    '=': ['000', '111', '000', '111', '000']
  };

  const scale = 3;
  const startX = Math.max(18, canvas.width - display.length * 12 - 12);
  const startY = 22;
  [...display].forEach((char, index) => {
    const glyph = glyphs[char] ?? glyphs['0'];
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, colIndex) => {
        if (pixel !== '1') {
          return;
        }
        const x = startX + index * 12 + colIndex * scale;
        const y = startY + rowIndex * scale;
        fillRect(canvas, x, y, x + scale - 1, y + scale - 1, [40, 40, 40]);
      });
    });
  });
}
