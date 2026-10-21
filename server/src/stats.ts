import type { Category, Stats } from '../../shared/types.js';

export const CATEGORIES: readonly Category[] = ['study', 'code', 'write', 'design', 'music', 'art', 'other'];
export const VISIBILITIES = ['public', 'followers', 'private'] as const;

const DAY = 86_400_000;

/** Parse YYYY-MM-DD into a UTC day number (days since epoch); null when malformed or not a real date. */
export function dayNum(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.toISOString().slice(0, 10) !== ymd) return null;
  return t / DAY;
}

export function ymdFromDayNum(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}

export const isValidYmd = (s: string) => dayNum(s) !== null;

export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Monday of the week containing the given day number. */
function mondayNum(n: number): number {
  const dow = new Date(n * DAY).getUTCDay(); // 0 = Sunday
  return n - ((dow + 6) % 7);
}

export const weekStartOf = (ymd: string): string => ymdFromDayNum(mondayNum(dayNum(ymd)!));

export function weekRange(today: string): { start: string; end: string } {
  const s = mondayNum(dayNum(today)!);
  return { start: ymdFromDayNum(s), end: ymdFromDayNum(s + 6) };
}

/**
 * Current streak: consecutive local dates with >=1 session, counting back from today
 * (or yesterday if nothing is logged today yet). A session dated "tomorrow" is tolerated as
 * an anchor to cope with clients ahead of the server's UTC clock.
 */
export function computeStreaks(dates: Iterable<string>, today: string): { current: number; longest: number } {
  const set = new Set<number>();
  for (const d of dates) {
    const n = dayNum(d);
    if (n !== null) set.add(n);
  }
  const sorted = [...set].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] === sorted[i - 1]! + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  const t = dayNum(today)!;
  let anchor: number | null = null;
  for (const cand of [t + 1, t, t - 1]) {
    if (set.has(cand)) {
      anchor = cand;
      break;
    }
  }
  let current = 0;
  if (anchor !== null) {
    for (let d = anchor; set.has(d); d--) current++;
  }
  return { current, longest };
}

export interface StatRow {
  localDate: string;
  focusMs: number;
  category: Category;
}

const toMin = (ms: number) => Math.round(ms / 60000);

export function computeStats(rows: StatRow[], today: string, weeklyGoalMin: number): Stats {
  const { current, longest } = computeStreaks(
    rows.map((r) => r.localDate),
    today,
  );
  const wk = weekRange(today);
  const wkStart = dayNum(wk.start)!;

  const weekMs = new Map<number, number>();
  for (let i = 0; i < 12; i++) weekMs.set(wkStart - 7 * (11 - i), 0);
  const catMs = new Map<Category, number>();
  let totalMs = 0;
  let thisWeekMs = 0;

  for (const r of rows) {
    totalMs += r.focusMs;
    catMs.set(r.category, (catMs.get(r.category) ?? 0) + r.focusMs);
    const n = dayNum(r.localDate);
    if (n === null) continue;
    const mon = mondayNum(n);
    if (weekMs.has(mon)) weekMs.set(mon, weekMs.get(mon)! + r.focusMs);
    if (mon === wkStart) thisWeekMs += r.focusMs;
  }

  return {
    totalSessions: rows.length,
    totalFocusMin: toMin(totalMs),
    streakDays: current,
    longestStreakDays: longest,
    thisWeekMin: toMin(thisWeekMs),
    weeklyGoalMin,
    weeks: [...weekMs.entries()].map(([n, ms]) => ({ weekStart: ymdFromDayNum(n), focusMin: toMin(ms) })),
    byCategory: [...catMs.entries()]
      .map(([category, ms]) => ({ category, focusMin: toMin(ms) }))
      .filter((c) => c.focusMin > 0)
      .sort((a, b) => b.focusMin - a.focusMin),
  };
}
