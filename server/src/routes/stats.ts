import { Router } from 'express';
import type { LeaderboardEntry } from '../../../shared/types.js';
import type { Ctx } from '../models.js';
import { visibleSql } from '../models.js';
import { computeStats, type StatRow, weekRange } from '../stats.js';
import { badRequest, wrap } from '../util.js';
import { parseToday } from './users.js';

export function statsRouter(ctx: Ctx): Router {
  const r = Router();
  const { db } = ctx;

  r.get(
    '/stats/me',
    wrap((req, res) => {
      const me = req.user!;
      const today = parseToday(req.query.today);
      const rows = db
        .prepare('SELECT local_date AS localDate, focus_ms AS focusMs, category FROM sessions WHERE user_id = ?')
        .all(me.id) as unknown as StatRow[];
      res.json(computeStats(rows, today, me.weekly_goal_min));
    }),
  );

  r.get(
    '/leaderboard',
    wrap((req, res) => {
      const me = req.user!;
      const period = req.query.period ?? 'week';
      if (period !== 'week') throw badRequest('period must be "week"');
      const { start, end } = weekRange(parseToday(req.query.today));
      // me + people I follow; sessions are counted only if visible to me (private sessions of others never leak).
      const rows = db
        .prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar_color,
             COALESCE(SUM(s.focus_ms), 0) AS focus_ms, COUNT(s.id) AS sessions
           FROM users u
           LEFT JOIN sessions s ON s.user_id = u.id AND s.local_date >= ?2 AND s.local_date <= ?3 AND ${visibleSql('s')}
           WHERE u.id = ?1 OR u.id IN (SELECT followee_id FROM follows WHERE follower_id = ?1)
           GROUP BY u.id`,
        )
        .all(me.id, start, end) as unknown as {
        id: string;
        username: string;
        display_name: string;
        avatar_color: string;
        focus_ms: number;
        sessions: number;
      }[];
      const entries = rows
        .map((u) => ({ ...u, focusMin: Math.round(u.focus_ms / 60000) }))
        .sort(
          (a, b) =>
            b.focus_ms - a.focus_ms || b.sessions - a.sessions || a.username.localeCompare(b.username),
        )
        .map(
          (u, i): LeaderboardEntry => ({
            user: { id: u.id, username: u.username, displayName: u.display_name, avatarColor: u.avatar_color },
            focusMin: u.focusMin,
            sessions: u.sessions,
            rank: i + 1,
          }),
        );
      res.json(entries);
    }),
  );

  return r;
}
