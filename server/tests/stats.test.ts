import { describe, expect, it } from 'vitest';
import { computeStats, computeStreaks, weekStartOf, type StatRow } from '../src/stats.js';

const row = (localDate: string, minutes = 60, category: StatRow['category'] = 'code'): StatRow => ({
  localDate,
  focusMs: minutes * 60000,
  category,
});

describe('computeStreaks', () => {
  it('is 0 with no sessions', () => {
    expect(computeStreaks([], '2025-03-10')).toEqual({ current: 0, longest: 0 });
  });
  it('counts consecutive days back from today', () => {
    expect(computeStreaks(['2025-03-08', '2025-03-09', '2025-03-10'], '2025-03-10')).toEqual({ current: 3, longest: 3 });
  });
  it('counts back from yesterday if nothing today yet', () => {
    expect(computeStreaks(['2025-03-08', '2025-03-09'], '2025-03-10').current).toBe(2);
  });
  it('is 0 when last session was 2+ days ago, but longest is preserved', () => {
    expect(computeStreaks(['2025-03-05', '2025-03-06', '2025-03-07'], '2025-03-10')).toEqual({ current: 0, longest: 3 });
  });
  it('a gap breaks the current streak', () => {
    const dates = ['2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04', '2025-03-08', '2025-03-09', '2025-03-10'];
    expect(computeStreaks(dates, '2025-03-10')).toEqual({ current: 3, longest: 4 });
  });
  it('dedupes multiple sessions on one day', () => {
    expect(computeStreaks(['2025-03-10', '2025-03-10', '2025-03-09'], '2025-03-10')).toEqual({ current: 2, longest: 2 });
  });
  it('handles month and year boundaries and leap day', () => {
    expect(computeStreaks(['2024-12-30', '2024-12-31', '2025-01-01'], '2025-01-01').current).toBe(3);
    expect(computeStreaks(['2024-02-28', '2024-02-29', '2024-03-01'], '2024-03-01').current).toBe(3);
    expect(computeStreaks(['2025-02-28', '2025-03-01'], '2025-03-01').current).toBe(2);
  });
  it('tolerates a session dated tomorrow (client ahead of server clock)', () => {
    expect(computeStreaks(['2025-03-09', '2025-03-10', '2025-03-11'], '2025-03-10').current).toBe(3);
  });
});

describe('weekStartOf', () => {
  it('uses Monday as week start', () => {
    expect(weekStartOf('2025-03-10')).toBe('2025-03-10'); // Monday
    expect(weekStartOf('2025-03-16')).toBe('2025-03-10'); // Sunday
    expect(weekStartOf('2025-03-17')).toBe('2025-03-17');
    expect(weekStartOf('2025-01-01')).toBe('2024-12-30');
  });
});

describe('computeStats', () => {
  const today = '2025-03-12'; // Wednesday; week = 03-10..03-16

  it('computes totals, this week (Monday boundary), 12 weeks and categories', () => {
    const rows = [
      row('2025-03-09', 100, 'study'), // Sunday: previous week
      row('2025-03-10', 30, 'code'), // Monday: this week
      row('2025-03-12', 45, 'code'),
      row('2025-03-12', 20, 'write'),
      row('2024-12-30', 10, 'art'), // exactly 10 weeks earlier
      row('2024-10-01', 500, 'music'), // older than 12 weeks: counts in totals only
    ];
    const s = computeStats(rows, today, 600);
    expect(s.totalSessions).toBe(6);
    expect(s.totalFocusMin).toBe(705);
    expect(s.thisWeekMin).toBe(95);
    expect(s.weeklyGoalMin).toBe(600);
    expect(s.weeks).toHaveLength(12);
    expect(s.weeks[11]).toEqual({ weekStart: '2025-03-10', focusMin: 95 });
    expect(s.weeks[10]).toEqual({ weekStart: '2025-03-03', focusMin: 100 });
    expect(s.weeks[0]).toEqual({ weekStart: '2024-12-23', focusMin: 0 });
    expect(s.weeks[1]).toEqual({ weekStart: '2024-12-30', focusMin: 10 });
    expect(s.weeks[6]).toEqual({ weekStart: '2025-02-03', focusMin: 0 });
    // oldest first, contiguous
    for (let i = 1; i < 12; i++) expect(s.weeks[i]!.weekStart > s.weeks[i - 1]!.weekStart).toBe(true);
    expect(s.byCategory).toEqual([
      { category: 'music', focusMin: 500 },
      { category: 'study', focusMin: 100 },
      { category: 'code', focusMin: 75 },
      { category: 'write', focusMin: 20 },
      { category: 'art', focusMin: 10 },
    ]);
    expect(s.streakDays).toBe(1);
  });

  it('Sunday today still belongs to the Monday-start week', () => {
    const s = computeStats([row('2025-03-10', 60), row('2025-03-16', 30)], '2025-03-16', 600);
    expect(s.thisWeekMin).toBe(90);
    expect(s.weeks[11]!.weekStart).toBe('2025-03-10');
  });

  it('empty stats have 12 zero weeks and no categories', () => {
    const s = computeStats([], today, 450);
    expect(s).toMatchObject({ totalSessions: 0, totalFocusMin: 0, streakDays: 0, longestStreakDays: 0, thisWeekMin: 0, weeklyGoalMin: 450, byCategory: [] });
    expect(s.weeks.every((w) => w.focusMin === 0)).toBe(true);
  });

  it('rounds minutes from ms and hides categories rounding to 0', () => {
    const s = computeStats(
      [
        { localDate: today, focusMs: 89_999, category: 'code' }, // 1.4999 -> 1
        { localDate: today, focusMs: 90_000, category: 'write' }, // 1.5 -> 2
        { localDate: today, focusMs: 20_000, category: 'art' }, // 0.33 -> 0 (hidden)
      ],
      today,
      600,
    );
    expect(s.byCategory).toEqual([
      { category: 'write', focusMin: 2 },
      { category: 'code', focusMin: 1 },
    ]);
  });
});
