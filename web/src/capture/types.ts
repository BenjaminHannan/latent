export interface CaptureOptions {
  intervalSec: number;
  facingMode: 'user' | 'environment';
  resolution: 480 | 720;
  suspendBetweenFrames: boolean;
}

export type CaptureStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'error';

export interface CaptureState {
  status: CaptureStatus;
  frameCount: number;
  elapsedMs: number;
  lastFrameUrl?: string;
  error?: string;
  bytesStored: number;
}

export interface CaptureSummary {
  frames: number;
  durationMs: number;
  startedAt: string;
  endedAt: string;
}

/** Persistence status of a session in IndexedDB. 'recording' = never finalized (crash/reload). */
export type SessionStatus = 'recording' | 'complete' | 'saved';

export interface SessionMeta {
  id: string;
  startedAt: string; // ISO
  intervalSec: number;
  frameCount: number;
  bytes: number;
  status: SessionStatus;
  /** Set when the session is finalized by stop(). */
  endedAt?: string;
  /** Focus time (excludes pauses). Updated with every stored frame, so it is a good estimate after a crash. */
  focusMs?: number;
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  intervalSec: 5,
  facingMode: 'environment',
  resolution: 720,
  suspendBetweenFrames: true,
};
