import type { Category } from '@shared/types';

export const categoryMeta: Record<Category, { label: string; emoji: string }> = {
  study: { label: 'Study', emoji: '📚' },
  code: { label: 'Code', emoji: '💻' },
  write: { label: 'Write', emoji: '✍️' },
  design: { label: 'Design', emoji: '📐' },
  music: { label: 'Music', emoji: '🎵' },
  art: { label: 'Art', emoji: '🎨' },
  other: { label: 'Other', emoji: '✨' },
};

export function categoryLabel(c: Category): string {
  return (categoryMeta[c] ?? categoryMeta.other).label;
}

/** 6_120_000 -> "1h 42m", 720_000 -> "12m", 45_000 -> "45s". */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

/** Elapsed clock "01:02:03". */
export function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}

/** Short video length "0:34". */
export function formatVideoLength(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

/** Minutes -> "6.5h" / "10h". */
export function formatHours(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h.toFixed(0) : h.toFixed(1)}h`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

export function timeAgo(iso: string, now: Date | number = Date.now()): string {
  const then = new Date(iso).getTime();
  const nowMs = typeof now === 'number' ? now : now.getTime();
  if (Number.isNaN(then)) return '';
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000));
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'Yesterday';
  if (day < 7) return `${day}d ago`;
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Local YYYY-MM-DD. */
export function localDateString(date: Date | string | number = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function partOfDay(date: Date): 'Morning' | 'Afternoon' | 'Evening' | 'Late-night' {
  const h = date.getHours();
  if (h < 5) return 'Late-night';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 21) return 'Evening';
  return 'Late-night';
}

/** "Morning Study Session" */
export function titleForSession(date: Date, category: Category): string {
  const noun = category === 'other' ? 'Focus' : categoryMeta[category].label;
  return `${partOfDay(date)} ${noun} Session`;
}

/** "Oct 21, 9:12 AM – 10:54 AM" */
export function formatTimeRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const date = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${date}, ${time(s)} – ${time(e)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}
