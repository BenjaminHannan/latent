import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraSource } from '../camera';
import { countFrames, getSessionMeta } from '../db';
import { CaptureSession } from '../session';
import type { CaptureOptions, CaptureState } from '../types';
import { fakeBlob, resetDb } from './helpers';

class FakeCamera implements CameraSource {
  open_ = false;
  opens = 0;
  closes = 0;
  grabs = 0;
  disposed = false;
  failOpenWith: Error | null = null;
  failGrab = false;
  get isOpen() {
    return this.open_;
  }
  async open() {
    if (this.failOpenWith) throw this.failOpenWith;
    if (!this.open_) this.opens++;
    this.open_ = true;
  }
  async grab() {
    if (!this.open_ || this.failGrab) throw new Error('not ready');
    this.grabs++;
    return fakeBlob(100);
  }
  close() {
    if (this.open_) this.closes++;
    this.open_ = false;
  }
  dispose() {
    this.close();
    this.disposed = true;
  }
  setPreview() {}
}

const wake = () => ({ acquire: vi.fn(async () => true), release: vi.fn(async () => {}) });

const opts = (o: Partial<CaptureOptions> = {}): CaptureOptions => ({
  intervalSec: 5,
  facingMode: 'environment',
  resolution: 720,
  suspendBetweenFrames: false,
  ...o,
});

// fake-indexeddb completes requests via (real, unfaked) setImmediate, so after each small
// slice of fake time we let real IO settle before moving on.
const realSetImmediate = (globalThis as unknown as { setImmediate: (cb: () => void) => void }).setImmediate;
const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise<void>((r) => realSetImmediate(r));
};
const advance = async (ms: number) => {
  for (let left = ms; left > 0; ) {
    const step = Math.min(100, left);
    await vi.advanceTimersByTimeAsync(step);
    await settle();
    left -= step;
  }
};

describe('CaptureSession', () => {
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-03-01T09:00:00.000Z'));
    URL.createObjectURL = vi.fn(() => `blob:mock-${Math.random()}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('captures an immediate first frame, then one per interval, persisting to IndexedDB', async () => {
    const cam = new FakeCamera();
    const s = new CaptureSession(opts(), { camera: cam, wakeLock: wake() });
    await s.start();
    expect(s.getState()).toMatchObject({ status: 'recording', frameCount: 1, bytesStored: 100 });
    expect(await countFrames(s.id)).toBe(1);

    await advance(5000);
    expect(s.getState().frameCount).toBe(2);
    await advance(10_000);
    expect(s.getState().frameCount).toBe(4);
    expect(await countFrames(s.id)).toBe(4);
    expect(await getSessionMeta(s.id)).toMatchObject({ frameCount: 4, bytes: 400, status: 'recording' });
    await s.stop();
  });

  it('pause/resume excludes paused time from elapsedMs and keeps capture aligned to focus time', async () => {
    const s = new CaptureSession(opts(), { camera: new FakeCamera(), wakeLock: wake() });
    await s.start();
    await advance(7000);
    expect(s.getState().elapsedMs).toBe(7000);
    expect(s.getState().frameCount).toBe(2); // t=0, t=5

    s.pause();
    expect(s.getState().status).toBe('paused');
    await advance(60_000);
    expect(s.getState().elapsedMs).toBe(7000); // frozen
    expect(s.getState().frameCount).toBe(2); // nothing captured while paused

    s.resume();
    expect(s.getState().status).toBe('recording');
    await advance(1000); // elapsed 8000
    expect(s.getState().frameCount).toBe(2);
    await advance(2000); // elapsed 10000 -> frame at focus time 10s
    expect(s.getState().elapsedMs).toBe(10_000);
    expect(s.getState().frameCount).toBe(3);

    const summary = await s.stop();
    expect(summary.frames).toBe(3);
    expect(summary.durationMs).toBe(10_000);
    expect(new Date(summary.endedAt).getTime() - new Date(summary.startedAt).getTime()).toBe(70_000);
  });

  it('emits state at least once per second while recording', async () => {
    const s = new CaptureSession(opts({ intervalSec: 30 }), { camera: new FakeCamera(), wakeLock: wake() });
    await s.start();
    const seen: CaptureState[] = [];
    s.subscribe((st) => seen.push(st));
    seen.length = 0;
    await advance(5000);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    const elapsed = seen.map((x) => x.elapsedMs);
    expect(elapsed).toEqual([...elapsed].sort((a, b) => a - b));
    await s.stop();
  });

  it('subscribe returns an unsubscribe function', async () => {
    const s = new CaptureSession(opts(), { camera: new FakeCamera(), wakeLock: wake() });
    const fn = vi.fn();
    const off = s.subscribe(fn);
    expect(fn).toHaveBeenCalledTimes(1); // initial snapshot
    off();
    await s.start();
    expect(fn).toHaveBeenCalledTimes(1);
    await s.stop();
  });

  it('stop() marks the session complete, releases wake lock and camera', async () => {
    const cam = new FakeCamera();
    const w = wake();
    const s = new CaptureSession(opts(), { camera: cam, wakeLock: w });
    await s.start();
    expect(w.acquire).toHaveBeenCalled();
    await advance(5000);
    const summary = await s.stop();
    expect(summary.frames).toBe(2);
    expect(summary.durationMs).toBe(5000);
    expect(w.release).toHaveBeenCalled();
    expect(cam.isOpen).toBe(false);
    expect(cam.disposed).toBe(true);
    const meta = await getSessionMeta(s.id);
    expect(meta).toMatchObject({ status: 'complete', frameCount: 2 });
    expect(meta?.endedAt).toBe(summary.endedAt);
    expect(s.getState().status).toBe('idle');
    await advance(20_000);
    expect(cam.grabs).toBe(2); // no more captures after stop
    expect(await s.stop()).toBe(summary); // idempotent
  });

  it('discard() deletes frames and metadata', async () => {
    const s = new CaptureSession(opts(), { camera: new FakeCamera(), wakeLock: wake() });
    await s.start();
    await advance(5000);
    await s.discard();
    expect(await countFrames(s.id)).toBe(0);
    expect(await getSessionMeta(s.id)).toBeUndefined();
    expect(s.getState()).toMatchObject({ status: 'idle', frameCount: 0, bytesStored: 0 });
  });

  it('revokes the previous lastFrameUrl when a new frame arrives', async () => {
    const s = new CaptureSession(opts(), { camera: new FakeCamera(), wakeLock: wake() });
    await s.start();
    const first = s.getState().lastFrameUrl;
    expect(first).toBeTruthy();
    await advance(5000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
    expect(s.getState().lastFrameUrl).not.toBe(first);
    await s.stop();
  });

  it('permission errors set status "error" with a friendly message and leave no data behind', async () => {
    const cam = new FakeCamera();
    const denied = new Error('Permission denied');
    denied.name = 'NotAllowedError';
    cam.failOpenWith = denied;
    const s = new CaptureSession(opts(), { camera: cam, wakeLock: wake() });
    await expect(s.start()).rejects.toThrow(/blocked/i);
    expect(s.getState().status).toBe('error');
    expect(s.getState().error).toMatch(/permission/i);
    expect(await getSessionMeta(s.id)).toBeUndefined();
  });

  it('suspendBetweenFrames (interval >= 10s) closes the camera after each capture and re-opens it ~1.5s early', async () => {
    const cam = new FakeCamera();
    const s = new CaptureSession(opts({ intervalSec: 10, suspendBetweenFrames: true }), { camera: cam, wakeLock: wake() });
    await s.start();
    expect(cam.isOpen).toBe(false); // closed right after the first frame
    expect(cam.opens).toBe(1);

    await advance(8000); // t=8s: still suspended
    expect(cam.isOpen).toBe(false);
    await advance(600); // t=8.6s: inside the 1.5s lead window
    expect(cam.opens).toBe(2);
    expect(s.getState().frameCount).toBe(1);
    await advance(1500); // t=10.1s: second frame taken, camera closed again
    expect(s.getState().frameCount).toBe(2);
    expect(cam.isOpen).toBe(false);
    await s.stop();
  });

  it('does not suspend for intervals below 10s even if requested', async () => {
    const cam = new FakeCamera();
    const s = new CaptureSession(opts({ intervalSec: 5, suspendBetweenFrames: true }), { camera: cam, wakeLock: wake() });
    await s.start();
    await advance(5000);
    expect(cam.isOpen).toBe(true);
    expect(cam.opens).toBe(1);
    await s.stop();
  });

  it('goes to "error" after repeated capture failures but stop() still salvages frames', async () => {
    const cam = new FakeCamera();
    const s = new CaptureSession(opts({ intervalSec: 1 }), { camera: cam, wakeLock: wake() });
    await s.start();
    expect(s.getState().frameCount).toBe(1);
    cam.failGrab = true;
    await advance(4000);
    expect(s.getState().status).toBe('error');
    expect(s.getState().error).toBeTruthy();
    const summary = await s.stop();
    expect(summary.frames).toBe(1);
    expect((await getSessionMeta(s.id))?.status).toBe('complete');
  });

  it('re-acquires the wake lock when the page becomes visible again', async () => {
    const w = wake();
    const s = new CaptureSession(opts(), { camera: new FakeCamera(), wakeLock: w });
    await s.start();
    w.acquire.mockClear();
    document.dispatchEvent(new Event('visibilitychange')); // jsdom: visibilityState is 'visible'
    expect(w.acquire).toHaveBeenCalledTimes(1);
    await s.stop();
    w.acquire.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(w.acquire).not.toHaveBeenCalled();
  });

  it('cannot be started twice', async () => {
    const s = new CaptureSession(opts(), { camera: new FakeCamera(), wakeLock: wake() });
    await s.start();
    await expect(s.start()).rejects.toThrow();
    await s.stop();
  });
});
