import type { CaptureOptions } from './types';
import { canvasToJpeg, createCanvas, get2d, type AnyCanvas } from './canvas';

/** Abstraction over "something that can give us JPEG frames". Injectable for tests. */
export interface CameraSource {
  /** True while a live camera stream is held. */
  readonly isOpen: boolean;
  /** Acquire the camera (no-op when already open). Rejects with a user-friendly Error. */
  open(): Promise<void>;
  /** Encode the current frame as JPEG. Requires open(). */
  grab(): Promise<Blob>;
  /** Stop all tracks (can be re-opened later). */
  close(): void;
  /** Close and remove any internal DOM. */
  dispose(): void;
  /** Mirror the live stream into a visible <video> (or null to detach). */
  setPreview(video: HTMLVideoElement | null): void;
}

export const JPEG_QUALITY = 0.7;

export class CameraError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}

/** Map getUserMedia failures to friendly messages. */
export function toCameraError(e: unknown): CameraError {
  if (e instanceof CameraError) return e;
  const name = (e as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return new CameraError(
        'permission-denied',
        'Camera access was blocked. Allow camera permission for this site in your browser settings, then try again.',
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return new CameraError('no-camera', 'No camera was found on this device.');
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError(
        'camera-busy',
        'The camera is in use by another app or could not be started. Close other apps using the camera and try again.',
      );
    default: {
      const msg = e instanceof Error && e.message ? e.message : 'unknown error';
      return new CameraError('unknown', `Could not start the camera (${msg}).`);
    }
  }
}

const READY_TIMEOUT_MS = 8000;

export class BrowserCameraSource implements CameraSource {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private preview: HTMLVideoElement | null = null;
  private canvas: AnyCanvas | null = null;

  constructor(private readonly opts: Pick<CaptureOptions, 'facingMode' | 'resolution'>) {}

  get isOpen(): boolean {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  async open(): Promise<void> {
    if (this.isOpen) return;
    this.stopStream();
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!md || typeof md.getUserMedia !== 'function') {
      throw new CameraError(
        'unsupported',
        'Camera capture is not supported here. Use a modern browser over HTTPS (or localhost).',
      );
    }
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: this.opts.facingMode }, height: { ideal: this.opts.resolution } },
      });
    } catch (e) {
      throw toCameraError(e);
    }
    this.stream = stream;
    try {
      const v = this.ensureVideo();
      v.srcObject = stream;
      await v.play().catch(() => {});
      await this.waitForVideo(v);
    } catch (e) {
      this.stopStream();
      throw toCameraError(e);
    }
    this.attachPreview();
  }

  async grab(): Promise<Blob> {
    const v = this.video;
    if (!v || !this.isOpen || v.videoWidth === 0 || v.videoHeight === 0) {
      throw new Error('Camera is not ready');
    }
    const maxSide = this.opts.resolution === 720 ? 1280 : 854;
    const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(2, Math.round(v.videoWidth * scale));
    const h = Math.max(2, Math.round(v.videoHeight * scale));
    if (!this.canvas) this.canvas = createCanvas(w, h);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    get2d(this.canvas).drawImage(v, 0, 0, w, h);
    return canvasToJpeg(this.canvas, JPEG_QUALITY);
  }

  close(): void {
    this.stopStream();
  }

  dispose(): void {
    this.stopStream();
    this.preview = null;
    this.canvas = null;
    if (this.video) {
      this.video.remove();
      this.video = null;
    }
  }

  setPreview(video: HTMLVideoElement | null): void {
    if (this.preview && this.preview !== video) this.preview.srcObject = null;
    this.preview = video;
    this.attachPreview();
  }

  private attachPreview(): void {
    const p = this.preview;
    if (!p || !this.stream) return;
    p.muted = true;
    p.playsInline = true;
    p.srcObject = this.stream;
    void p.play().catch(() => {});
  }

  private stopStream(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    if (this.preview) this.preview.srcObject = null;
  }

  /** Hidden element used for frame grabbing (kept in the DOM; iOS Safari won't decode detached video). */
  private ensureVideo(): HTMLVideoElement {
    if (this.video) return this.video;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('aria-hidden', 'true');
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(v);
    this.video = v;
    return v;
  }

  private waitForVideo(v: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (v.videoWidth > 0 && v.readyState >= 2) return resolve();
        if (Date.now() - started > READY_TIMEOUT_MS) return reject(new Error('camera did not produce video'));
        setTimeout(check, 50);
      };
      check();
    });
  }
}
