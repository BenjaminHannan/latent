import { isActive } from './active';
import { countFrames, deleteSessionData, getFrame, getFrames, listSessionMetas, updateSessionMeta } from './db';

export type {
  CaptureOptions,
  CaptureState,
  CaptureStatus,
  CaptureSummary,
  SessionMeta,
  SessionStatus,
} from './types';
export { DEFAULT_CAPTURE_OPTIONS } from './types';
export { CaptureSession } from './session';
export type { CaptureDeps } from './session';
export type { CameraSource } from './camera';
export { renderTimelapse, RenderUnsupportedError, isRenderSupported, formatElapsed } from './render';
export type { RenderOptions, RenderResult } from './render';
export { estimateStorage, formatBytes } from './estimate';
export { WakeLockManager } from './wakelock';
export { getSessionMeta } from './db';

/** Sessions with stored frames that were never marked saved (e.g. crash, reload, failed upload). */
export async function listRecoverableSessions(): Promise<{ id: string; frames: number; startedAt: string }[]> {
  const metas = await listSessionMetas();
  const out: { id: string; frames: number; startedAt: string }[] = [];
  for (const m of metas) {
    if (m.status === 'saved' || isActive(m.id)) continue;
    const frames = await countFrames(m.id);
    if (frames >= 1) out.push({ id: m.id, frames, startedAt: m.startedAt });
  }
  return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)); // newest first
}

/** Mark a session as uploaded; it no longer shows up as recoverable. Call deleteFrames() afterwards to free space. */
export async function markSessionSaved(sessionId: string): Promise<void> {
  await updateSessionMeta(sessionId, { status: 'saved' });
}

/** Delete all frames and the metadata record of a session. */
export async function deleteFrames(sessionId: string): Promise<void> {
  await deleteSessionData(sessionId);
}

/** All stored JPEG frames of a session in order (for a fallback frame player). */
export function loadFrames(sessionId: string): Promise<Blob[]> {
  return getFrames(sessionId);
}

/** One stored frame (undefined if missing). */
export function loadFrame(sessionId: string, index: number): Promise<Blob | undefined> {
  return getFrame(sessionId, index);
}

/** True when the browser can capture (getUserMedia + IndexedDB). */
export function isCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function' &&
    typeof indexedDB !== 'undefined'
  );
}
