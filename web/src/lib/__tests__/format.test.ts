import { describe, expect, it } from 'vitest';
import {
  categoryMeta,
  formatBytes,
  formatClock,
  formatDuration,
  formatHours,
  initials,
  localDateString,
  timeAgo,
  titleForSession,
} from '../format';

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(12 * 60_000)).toBe('12m');
    expect(formatDuration((60 + 42) * 60_000)).toBe('1h 42m');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(59_999)).toBe('59s');
    expect(formatDuration(2 * 3600_000)).toBe('2h 0m');
  });
});

describe('formatClock', () => {
  it('pads HH:MM:SS', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock((3600 + 2 * 60 + 3) * 1000)).toBe('01:02:03');
    expect(formatClock(59_999)).toBe('00:00:59');
    expect(formatClock(100 * 3600_000)).toBe('100:00:00');
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-03-10T12:00:00Z').getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('describes recent times', () => {
    expect(timeAgo(ago(10_000), now)).toBe('just now');
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5m ago');
    expect(timeAgo(ago(3 * 3600_000), now)).toBe('3h ago');
    expect(timeAgo(ago(30 * 3600_000), now)).toBe('Yesterday');
    expect(timeAgo(ago(3 * 86400_000), now)).toBe('3d ago');
  });
  it('falls back to a date for older items and handles junk', () => {
    expect(timeAgo(ago(20 * 86400_000), now)).toMatch(/\w+ \d+/);
    expect(timeAgo('not a date', now)).toBe('');
  });
});

describe('localDateString', () => {
  it('uses local date parts, zero padded', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateString(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});

describe('titleForSession', () => {
  const at = (h: number) => new Date(2026, 2, 10, h, 0);
  it('picks part of day and category', () => {
    expect(titleForSession(at(9), 'study')).toBe('Morning Study Session');
    expect(titleForSession(at(13), 'code')).toBe('Afternoon Code Session');
    expect(titleForSession(at(19), 'art')).toBe('Evening Art Session');
    expect(titleForSession(at(22), 'write')).toBe('Late-night Write Session');
    expect(titleForSession(at(9), 'other')).toBe('Morning Focus Session');
  });
});

describe('misc helpers', () => {
  it('has meta for every category', () => {
    for (const c of ['study', 'code', 'write', 'design', 'music', 'art', 'other'] as const) {
      expect(categoryMeta[c].label).toBeTruthy();
      expect(categoryMeta[c].emoji).toBeTruthy();
    }
  });
  it('formats bytes, hours and initials', () => {
    expect(formatBytes(36 * 1024 * 1024)).toBe('36 MB');
    expect(formatBytes(3.6 * 1024 ** 3)).toBe('3.6 GB');
    expect(formatHours(390)).toBe('6.5h');
    expect(formatHours(600)).toBe('10h');
    expect(initials('Ada Lovelace')).toBe('AL');
    expect(initials('plato')).toBe('P');
  });
});
