import { canvasToJpeg, createCanvas, decodeImage, get2d, type Ctx2D } from './canvas';
import { getFrame, getSessionMeta } from './db';

export class RenderUnsupportedError extends Error {
  readonly code = 'UNSUPPORTED' as const;
  constructor(message = 'Video rendering (MediaRecorder + canvas.captureStream) is not supported in this browser.') {
    super(message);
    this.name = 'RenderUnsupportedError';
  }
}

export interface RenderOptions {
  fps?: number;
  onProgress?: (p: number) => void;
  overlay?: { label?: string };
}

export interface RenderResult {
  video: Blob;
  mimeType: string;
  thumbnail: Blob;
  videoDurationMs: number;
}

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** True when renderTimelapse() can work in this browser. */
export function isRenderSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
}

/** "4:05" / "1:02:09" */
export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function drawOverlay(ctx: Ctx2D, w: number, h: number, label: string | undefined, stamp: string): void {
  const base = Math.max(12, Math.round(h * 0.035));
  const pad = Math.round(base * 0.6);
  const pill = (text: string, x: number, y: number, align: 'left' | 'right') => {
    ctx.font = `600 ${base}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const bw = tw + pad * 2;
    const bh = base + pad;
    const bx = align === 'left' ? x : x - bw;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx, y - bh / 2, bw, bh);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + pad, y + 1);
  };
  const margin = Math.round(base * 0.8);
  if (label) pill(label, margin, h - margin - base / 2, 'left');
  pill(stamp, w - margin, margin + base / 2, 'right');
}

/**
 * Assemble stored frames into a video (real-time: duration ≈ frames / fps seconds) and a thumbnail.
 * Throws RenderUnsupportedError (code 'UNSUPPORTED') when MediaRecorder/captureStream are missing.
 */
export async function renderTimelapse(sessionId: string, opts: RenderOptions = {}): Promise<RenderResult> {
  if (!isRenderSupported()) throw new RenderUnsupportedError();
  const fps = opts.fps && opts.fps > 0 ? opts.fps : 30;
  const frameMs = 1000 / fps;
  const report = (p: number) => opts.onProgress?.(Math.min(1, Math.max(0, p)));

  const meta = await getSessionMeta(sessionId);
  if (!meta) throw new Error(`Capture session ${sessionId} not found`);
  const total = meta.frameCount;
  if (total < 1) throw new Error('This session has no frames to render');

  const first = await getFrame(sessionId, 0);
  if (!first) throw new Error('Session frames are missing');
  const firstImg = await decodeImage(first);
  const W = Math.max(2, firstImg.width & ~1);
  const H = Math.max(2, firstImg.height & ~1);
  firstImg.close();

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
  const requestFrame = () => {
    if (track && typeof track.requestFrame === 'function') track.requestFrame();
  };

  const mime = pickMimeType();
  const recorderOpts: MediaRecorderOptions = { videoBitsPerSecond: Math.max(1_500_000, Math.round(W * H * 3)) };
  if (mime) recorderOpts.mimeType = mime;
  const recorder = new MediaRecorder(stream, recorderOpts);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error('Video encoding failed'));
  });

  const drawFrame = async (index: number): Promise<boolean> => {
    const blob = await getFrame(sessionId, index);
    if (!blob) return false;
    const img = await decodeImage(blob);
    try {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (img.width === W && img.height === H) {
        ctx.drawImage(img.source, 0, 0);
      } else {
        const s = Math.min(W / img.width, H / img.height);
        const dw = img.width * s;
        const dh = img.height * s;
        ctx.drawImage(img.source, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
    } finally {
      img.close();
    }
    drawOverlay(ctx, W, H, opts.overlay?.label, formatElapsed(index * meta.intervalSec));
    return true;
  };

  try {
    recorder.start(1000);
    const t0 = performance.now();
    let drawn = 0;
    for (let i = 0; i < total; i++) {
      if (await drawFrame(i)) {
        requestFrame();
        drawn++;
      }
      report(((i + 1) / total) * 0.98);
      const wait = t0 + (i + 1) * frameMs - performance.now();
      if (wait > 0) await sleep(wait);
    }
    if (drawn === 0) throw new Error('Session frames are missing');
    // Make sure the final frame is flushed into the stream before stopping.
    requestFrame();
    await sleep(frameMs);
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
  } catch (e) {
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    throw e;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }

  const baseMime = (recorder.mimeType || mime || 'video/webm').split(';')[0] || 'video/webm';
  const video = new Blob(chunks, { type: baseMime });

  const thumbnail = await makeThumbnail(sessionId, Math.floor((total - 1) / 2), total);
  report(1);
  return { video, mimeType: baseMime, thumbnail, videoDurationMs: Math.round(total * frameMs) };
}

async function makeThumbnail(sessionId: string, preferred: number, total: number): Promise<Blob> {
  // Prefer the middle frame; fall back to any frame that exists.
  const order = [preferred, ...Array.from({ length: total }, (_, i) => i).filter((i) => i !== preferred)];
  for (const idx of order) {
    const blob = await getFrame(sessionId, idx);
    if (!blob) continue;
    const img = await decodeImage(blob);
    try {
      const scale = Math.min(1, 640 / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = createCanvas(w, h);
      get2d(c).drawImage(img.source, 0, 0, w, h);
      return await canvasToJpeg(c, 0.8);
    } finally {
      img.close();
    }
  }
  throw new Error('Session frames are missing');
}
