/** ~50 KB per 720p JPEG at quality 0.7. */
export const AVG_FRAME_BYTES = 50_000;
/** ~8 Mbps 1080p video ≈ 1 MB per second. */
export const VIDEO_BYTES_PER_SEC = 1_000_000;

export function estimateStorage(
  durationMin: number,
  intervalSec: number,
): { frames: number; bytes: number; videoBytesEquivalent: number } {
  const seconds = Math.max(0, durationMin) * 60;
  const frames = intervalSec > 0 ? Math.ceil(seconds / intervalSec) : 0;
  return {
    frames,
    bytes: frames * AVG_FRAME_BYTES,
    videoBytesEquivalent: seconds * VIDEO_BYTES_PER_SEC,
  };
}

/** Human readable size, decimal units ("70 MB", "12 GB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  const digits = u === 0 || v >= 100 ? 0 : v >= 10 ? 0 : 1;
  return `${v.toFixed(digits)} ${units[u]}`;
}
