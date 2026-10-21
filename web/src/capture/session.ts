import { markActive, unmarkActive } from './active';
import { BrowserCameraSource, toCameraError, type CameraSource } from './camera';
import { addFrame, deleteSessionData, putSessionMeta, updateSessionMeta } from './db';
import type { CaptureOptions, CaptureState, CaptureStatus, CaptureSummary } from './types';
import { WakeLockManager } from './wakelock';

/** Max time between state emissions while recording. */
const TICK_MS = 900;
/** With suspendBetweenFrames, re-acquire the camera this long before the next capture. */
const WAKE_LEAD_MS = 1500;
/** Give up (status 'error') after this many consecutive failed captures. */
const MAX_CONSECUTIVE_FAILURES = 3;
const MIN_SUSPEND_INTERVAL_SEC = 10;

export interface CaptureDeps {
  camera?: CameraSource;
  wakeLock?: Pick<WakeLockManager, 'acquire' | 'release'>;
  /** Epoch-ms clock (default Date.now). */
  now?: () => number;
}

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const noop = () => {};

/**
 * One recording session. Single-use: create → start → (pause/resume)* → stop | discard.
 * Frames are written to IndexedDB as they are captured.
 */
export class CaptureSession {
  readonly id: string = newId();

  private readonly opts: CaptureOptions;
  private readonly camera: CameraSource;
  private readonly wake: Pick<WakeLockManager, 'acquire' | 'release'>;
  private readonly now: () => number;
  private readonly suspend: boolean;
  private readonly stepMs: number;

  private status: CaptureStatus = 'idle';
  private used = false;
  private finished: CaptureSummary | null = null;
  private listeners = new Set<(s: CaptureState) => void>();

  private frameCount = 0;
  private bytesStored = 0;
  private lastFrameUrl: string | undefined;
  private error: string | undefined;

  private startedAtMs = 0;
  private accumulatedMs = 0;
  private runStartedAt: number | null = null;
  private nextCaptureAt = 0;
  private warmedFor = -1;
  private failures = 0;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private capturing: Promise<void> | null = null;
  private opening: Promise<void> | null = null;
  private onVisibility: (() => void) | null = null;

  constructor(opts: CaptureOptions, deps: CaptureDeps = {}) {
    if (!(opts.intervalSec > 0)) throw new Error('intervalSec must be > 0');
    this.opts = { ...opts };
    this.stepMs = opts.intervalSec * 1000;
    this.suspend = opts.suspendBetweenFrames && opts.intervalSec >= MIN_SUSPEND_INTERVAL_SEC;
    this.camera = deps.camera ?? new BrowserCameraSource(opts);
    this.wake = deps.wakeLock ?? new WakeLockManager();
    this.now = deps.now ?? Date.now;
  }

  // ---- public API --------------------------------------------------------

  attachPreview(video: HTMLVideoElement): void {
    this.camera.setPreview(video);
  }

  getState(): CaptureState {
    const s: CaptureState = {
      status: this.status,
      frameCount: this.frameCount,
      elapsedMs: Math.floor(this.elapsed()),
      bytesStored: this.bytesStored,
    };
    if (this.lastFrameUrl) s.lastFrameUrl = this.lastFrameUrl;
    if (this.error) s.error = this.error;
    return s;
  }

  /** Calls `fn` immediately with the current state, then on every change (>= 1/s while recording). */
  subscribe(fn: (s: CaptureState) => void): () => void {
    this.listeners.add(fn);
    try {
      fn(this.getState());
    } catch {
      /* listener errors must not break the engine */
    }
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Acquire the camera and start recording (first frame is captured immediately).
   * On failure sets status 'error' (with `error` message) and rejects with the same friendly message.
   */
  async start(): Promise<void> {
    if (this.used) throw new Error('CaptureSession can only be started once');
    this.used = true;
    this.status = 'starting';
    this.emit();
    markActive(this.id);
    try {
      this.startedAtMs = this.now();
      await putSessionMeta({
        id: this.id,
        startedAt: new Date(this.startedAtMs).toISOString(),
        intervalSec: this.opts.intervalSec,
        frameCount: 0,
        bytes: 0,
        status: 'recording',
        focusMs: 0,
      });
      await this.ensureOpen();
    } catch (e) {
      const err = toCameraError(e);
      await deleteSessionData(this.id).catch(noop);
      unmarkActive(this.id);
      this.camera.dispose();
      this.status = 'error';
      this.error = err.message;
      this.emit();
      throw err;
    }
    if (this.status !== 'starting') {
      // stop()/discard() was called while the camera was being acquired.
      this.camera.close();
      return;
    }
    void this.wake.acquire().catch(noop);
    this.addVisibilityListener();
    this.runStartedAt = this.now();
    this.status = 'recording';
    this.emit();
    await this.captureNow();
    this.schedule();
  }

  pause(): void {
    if (this.status !== 'recording') return;
    this.accumulatedMs = this.elapsed();
    this.runStartedAt = null;
    this.status = 'paused';
    this.clearTimer();
    this.emit();
    // Release the camera while paused (after any in-flight capture settles).
    void (this.capturing ?? Promise.resolve()).then(() => {
      if (this.status === 'paused') this.camera.close();
    });
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.runStartedAt = this.now();
    this.status = 'recording';
    this.emit();
    if (!this.suspend) void this.ensureOpen().catch(noop);
    this.schedule();
  }

  async stop(): Promise<CaptureSummary> {
    if (this.finished) return this.finished;
    const hadStarted = this.startedAtMs > 0;
    await this.halt();
    const endedAtMs = this.now();
    if (hadStarted) {
      await updateSessionMeta(this.id, {
        status: 'complete',
        endedAt: new Date(endedAtMs).toISOString(),
        focusMs: Math.floor(this.accumulatedMs),
      }).catch(noop);
    }
    unmarkActive(this.id);
    const startedMs = hadStarted ? this.startedAtMs : endedAtMs;
    this.finished = {
      frames: this.frameCount,
      durationMs: Math.floor(this.accumulatedMs),
      startedAt: new Date(startedMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
    };
    this.status = 'idle';
    this.error = undefined;
    this.emit();
    return this.finished;
  }

  /** Stop and delete all stored frames and metadata for this session. */
  async discard(): Promise<void> {
    await this.halt();
    await deleteSessionData(this.id).catch(noop);
    unmarkActive(this.id);
    this.revokeLastFrame();
    this.frameCount = 0;
    this.bytesStored = 0;
    this.accumulatedMs = 0;
    this.finished = { frames: 0, durationMs: 0, startedAt: new Date(this.startedAtMs || this.now()).toISOString(), endedAt: new Date(this.now()).toISOString() };
    this.status = 'idle';
    this.error = undefined;
    this.emit();
  }

  // ---- internals ---------------------------------------------------------

  private elapsed(): number {
    return this.accumulatedMs + (this.runStartedAt !== null ? this.now() - this.runStartedAt : 0);
  }

  /** Freeze the clock, wait for in-flight work, release camera + wake lock. */
  private async halt(): Promise<void> {
    this.status = 'stopping';
    this.emit();
    this.clearTimer();
    if (this.runStartedAt !== null) {
      this.accumulatedMs = this.elapsed();
      this.runStartedAt = null;
    }
    await (this.capturing ?? Promise.resolve()).catch(noop);
    await (this.opening ?? Promise.resolve()).catch(noop);
    this.camera.dispose();
    this.removeVisibilityListener();
    await this.wake.release().catch(noop);
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const s = this.getState();
    for (const fn of [...this.listeners]) {
      try {
        fn(s);
      } catch {
        /* ignore */
      }
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private needsWarmup(): boolean {
    return this.suspend && !this.camera.isOpen && !this.opening && this.warmedFor !== this.nextCaptureAt;
  }

  private schedule(): void {
    this.clearTimer();
    if (this.status !== 'recording') return;
    const el = this.elapsed();
    let wait = Math.min(TICK_MS, this.nextCaptureAt - el);
    if (this.needsWarmup()) wait = Math.min(wait, this.nextCaptureAt - WAKE_LEAD_MS - el);
    this.timer = setTimeout(() => void this.tick(), Math.max(0, wait));
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (this.status !== 'recording') return;
    const el = this.elapsed();
    if (el >= this.nextCaptureAt) {
      await this.captureNow();
    } else if (this.needsWarmup() && el >= this.nextCaptureAt - WAKE_LEAD_MS) {
      this.warmedFor = this.nextCaptureAt;
      void this.ensureOpen().catch(noop); // a failure here is retried (and counted) at capture time
    }
    if (this.status === 'recording') {
      this.emit();
      this.schedule();
    }
  }

  private ensureOpen(): Promise<void> {
    if (this.camera.isOpen) return Promise.resolve();
    if (!this.opening) {
      const p = this.camera.open().finally(() => {
        if (this.opening === p) this.opening = null;
      });
      this.opening = p;
    }
    return this.opening;
  }

  private captureNow(): Promise<void> {
    if (this.capturing) return this.capturing;
    const p = this.doCapture().finally(() => {
      if (this.capturing === p) this.capturing = null;
    });
    this.capturing = p;
    return p;
  }

  private async doCapture(): Promise<void> {
    const index = this.frameCount;
    const at = this.elapsed();
    try {
      await this.ensureOpen();
      const blob = await this.camera.grab();
      const meta = await addFrame(this.id, index, blob, Math.floor(at));
      this.frameCount = meta.frameCount;
      this.bytesStored = meta.bytes;
      this.revokeLastFrame();
      this.lastFrameUrl = URL.createObjectURL(blob);
      this.failures = 0;
    } catch (e) {
      this.failures++;
      if (this.failures >= MAX_CONSECUTIVE_FAILURES && this.status === 'recording') {
        this.fail(toCameraError(e).message);
        return;
      }
    }
    // Stay aligned to elapsed focus time; never burst to "catch up" after a stall.
    this.nextCaptureAt += this.stepMs;
    const el = this.elapsed();
    if (this.nextCaptureAt <= el) this.nextCaptureAt = (Math.floor(el / this.stepMs) + 1) * this.stepMs;
    if (this.suspend && this.status !== 'stopping') this.camera.close();
    if (this.status === 'recording') this.emit();
  }

  /** Unrecoverable problem mid-session: freeze the clock, keep frames (stop() can still salvage them). */
  private fail(message: string): void {
    this.clearTimer();
    if (this.runStartedAt !== null) {
      this.accumulatedMs = this.elapsed();
      this.runStartedAt = null;
    }
    this.camera.close();
    void this.wake.release().catch(noop);
    this.status = 'error';
    this.error = message;
    this.emit();
  }

  private revokeLastFrame(): void {
    if (this.lastFrameUrl) {
      try {
        URL.revokeObjectURL(this.lastFrameUrl);
      } catch {
        /* ignore */
      }
      this.lastFrameUrl = undefined;
    }
  }

  private addVisibilityListener(): void {
    if (typeof document === 'undefined' || this.onVisibility) return;
    this.onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.status === 'recording' || this.status === 'paused') void this.wake.acquire().catch(noop);
      if (this.status === 'recording') this.schedule(); // timers are throttled while hidden
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private removeVisibilityListener(): void {
    if (this.onVisibility && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.onVisibility = null;
  }
}
