import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LeaderboardEntry, Stats } from '../../shared/types.js';
import { auth, makeApp, signup, type TestCtx, upload } from './helpers.js';

let t: TestCtx;
beforeEach(() => {
  t = makeApp();
});
afterEach(() => t.cleanup());

const day = (d: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  localDate: d,
  startedAt: `${d}T09:00:00.000Z`,
  endedAt: `${d}T10:00:00.000Z`,
  focusMs: minutes * 60000,
  ...extra,
});

describe('GET /api/stats/me', () => {
  it('returns empty stats for a new user', async () => {
    const u = await signup(t.app, 'alice');
    const res = await request(t.app).get('/api/stats/me?today=2025-03-12').set(auth(u));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalSessions: 0, totalFocusMin: 0, streakDays: 0, longestStreakDays: 0, thisWeekMin: 0, weeklyGoalMin: 600, byCategory: [] });
    expect(res.body.weeks).toHaveLength(12);
  });

  it('computes streaks (gap, longest), week boundaries and categories via ?today', async () => {
    const u = await signup(t.app, 'alice');
    // run of 4 (Feb 25-28), gap, then Mar 9 (Sun, prev week), Mar 10 (Mon), Mar 11 (Tue, 2 sessions)
    for (const d of ['2025-02-25', '2025-02-26', '2025-02-27', '2025-02-28']) await upload(t.app, u, day(d, 30, { category: 'study' }));
    await upload(t.app, u, day('2025-03-09', 100, { category: 'write' }));
    await upload(t.app, u, day('2025-03-10', 60, { category: 'code' }));
    await upload(t.app, u, day('2025-03-11', 60, { category: 'code' }));
    await upload(t.app, u, day('2025-03-11', 15, { category: 'code', visibility: 'private' }));

    const s = (await request(t.app).get('/api/stats/me?today=2025-03-11').set(auth(u))).body as Stats;
    expect(s.totalSessions).toBe(8);
    expect(s.totalFocusMin).toBe(4 * 30 + 100 + 60 + 60 + 15);
    expect(s.streakDays).toBe(3); // Mar 9, 10, 11
    expect(s.longestStreakDays).toBe(4);
    expect(s.thisWeekMin).toBe(135); // Mon Mar 10 + Tue Mar 11 (Sunday Mar 9 is last week)
    expect(s.weeks[11]).toEqual({ weekStart: '2025-03-10', focusMin: 135 });
    expect(s.weeks[10]).toEqual({ weekStart: '2025-03-03', focusMin: 100 });
    expect(s.weeks[9]).toEqual({ weekStart: '2025-02-24', focusMin: 120 });
    expect(s.byCategory).toEqual([
      { category: 'code', focusMin: 135 },
      { category: 'study', focusMin: 120 },
      { category: 'write', focusMin: 100 },
    ]);

    // same data seen from "yesterday has nothing" vantage: today = Mar 12 -> streak counts from Mar 11
    const s2 = (await request(t.app).get('/api/stats/me?today=2025-03-12').set(auth(u))).body as Stats;
    expect(s2.streakDays).toBe(3);
    // two days later the streak is gone but longest persists
    const s3 = (await request(t.app).get('/api/stats/me?today=2025-03-13').set(auth(u))).body as Stats;
    expect(s3.streakDays).toBe(0);
    expect(s3.longestStreakDays).toBe(4);
    expect(s3.thisWeekMin).toBe(135);
    // next Monday: new week starts empty
    const s4 = (await request(t.app).get('/api/stats/me?today=2025-03-17').set(auth(u))).body as Stats;
    expect(s4.thisWeekMin).toBe(0);
    expect(s4.weeks[10]).toEqual({ weekStart: '2025-03-10', focusMin: 135 });

    expect((await request(t.app).get('/api/stats/me?today=banana').set(auth(u))).status).toBe(400);
    const profile = await request(t.app).get('/api/users/alice?today=2025-03-11').set(auth(u));
    expect(profile.body).toMatchObject({ streakDays: 3, sessionCount: 8, totalFocusMin: 4 * 30 + 100 + 60 + 60 + 15 });
  });

  it('defaults today to the server UTC date', async () => {
    const u = await signup(t.app, 'alice');
    const today = new Date().toISOString().slice(0, 10);
    await upload(t.app, u, day(today, 20));
    const s = (await request(t.app).get('/api/stats/me').set(auth(u))).body as Stats;
    expect(s.streakDays).toBe(1);
    expect(s.thisWeekMin).toBe(20);
  });

  it('respects weeklyGoalMin from the profile', async () => {
    const u = await signup(t.app, 'alice');
    await request(t.app).patch('/api/me').set(auth(u)).send({ weeklyGoalMin: 240 });
    const s = (await request(t.app).get('/api/stats/me').set(auth(u))).body as Stats;
    expect(s.weeklyGoalMin).toBe(240);
  });
});

describe('GET /api/leaderboard', () => {
  it('ranks me + followees by this week focus minutes, including zeros, excluding non-followed', async () => {
    const me = await signup(t.app, 'me_user');
    const a = await signup(t.app, 'fa_x');
    const b = await signup(t.app, 'fb_x');
    const idle = await signup(t.app, 'idle');
    const stranger = await signup(t.app, 'stranger');
    for (const n of ['fa_x', 'fb_x', 'idle']) await request(t.app).post(`/api/users/${n}/follow`).set(auth(me));

    const today = '2025-03-12'; // week Mar 10-16
    await upload(t.app, me, day('2025-03-10', 50));
    await upload(t.app, me, day('2025-03-09', 500)); // previous week: excluded
    await upload(t.app, a, day('2025-03-11', 90));
    await upload(t.app, a, day('2025-03-12', 30));
    await upload(t.app, b, day('2025-03-16', 70)); // Sunday still in week
    await upload(t.app, b, day('2025-03-17', 999)); // next week: excluded
    await upload(t.app, b, day('2025-03-12', 500, { visibility: 'private' })); // private of other: not counted for me
    await upload(t.app, stranger, day('2025-03-12', 1000));
    void idle;

    const res = await request(t.app).get(`/api/leaderboard?period=week&today=${today}`).set(auth(me));
    expect(res.status).toBe(200);
    const lb = res.body as LeaderboardEntry[];
    expect(lb.map((e) => [e.user.username, e.focusMin, e.sessions, e.rank])).toEqual([
      ['fa_x', 120, 2, 1],
      ['fb_x', 70, 1, 2],
      ['me_user', 50, 1, 3],
      ['idle', 0, 0, 4],
    ]);
    expect(lb[0]!.user).toMatchObject({ displayName: 'User fa_x' });
    expect(lb[0]!.user.avatarColor).toMatch(/^#/);

    // my own private sessions do count for me
    await upload(t.app, me, day('2025-03-12', 100, { visibility: 'private' }));
    const again = (await request(t.app).get(`/api/leaderboard?today=${today}`).set(auth(me))).body as LeaderboardEntry[];
    expect(again[0]).toMatchObject({ focusMin: 150 });
    expect(again[0]!.user.username).toBe('me_user');

    expect((await request(t.app).get('/api/leaderboard?period=month').set(auth(me))).status).toBe(400);
  });
});
