import type { Category } from '@shared/types';

export interface RecordSettings {
  intervalSec: number;
  category: Category;
  facingMode: 'user' | 'environment';
  batterySaver: boolean;
}

export const INTERVAL_OPTIONS = [1, 2, 5, 10, 30] as const;

/** What we know about a finished (or recovered) capture session. */
export interface SessionInfo {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  focusMs: number;
  frameCount: number;
  intervalSec: number;
  category: Category;
  recovered?: boolean;
}

export interface Rendered {
  video: Blob;
  mimeType: string;
  thumbnail: Blob;
  videoDurationMs: number;
}
