import { Router } from 'express';
import type { AuthResponse, User, UserProfile } from '../../../shared/types.js';
import { hashPassword, newToken, randomAvatarColor, verifyPassword, type UserRow } from '../auth.js';
import { tx } from '../db.js';
import { type Ctx, toUser, visibleSql } from '../models.js';
import { computeStreaks, isValidYmd, todayUtc } from '../stats.js';
import { badRequest, HttpError, isObj, nowIso, num, str, wrap } from '../util.js';
import crypto from 'node:crypto';

const RESERVED_USERNAMES = new Set(['search']);
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('username is required');
  return v.trim().toLowerCase();
}

export function parseToday(q: unknown): string {
  if (q === undefined || q === '') return todayUtc();
  if (typeof q !== 'string' || !isValidYmd(q)) throw badRequest('today must be a YYYY-MM-DD date');
  return q;
}

export function authRouter(ctx: Ctx): Router {
  const r = Router();
  const { db } = ctx;

  const issueToken = (userId: string) => {
    const token = newToken();
    db.prepare('INSERT INTO tokens (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, nowIso());
    return token;
  };

  r.post(
    '/signup',
    wrap(async (req, res) => {
      const body = isObj(req.body) ? req.body : {};
      const username = normalizeUsername(body.username);
      if (!USERNAME_RE.test(username) || RESERVED_USERNAMES.has(username)) {
        throw badRequest(
          RESERVED_USERNAMES.has(username)
            ? 'That username is reserved'
            : 'username must be 3-20 characters: lowercase letters, numbers, underscore',
        );
      }
      const displayName = str(body, 'displayName', { min: 1, max: 40 })!;
      const password = str(body, 'password', { min: 6, max: 200, trim: false })!;
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
        throw new HttpError(409, 'That username is already taken');
      }
      const { hash, salt } = await hashPassword(password);
      const id = crypto.randomUUID();
      let token = '';
      try {
        tx(db, () => {
          db.prepare(
            `INSERT INTO users (id, username, display_name, bio, avatar_color, weekly_goal_min, password_hash, password_salt, created_at)
             VALUES (?, ?, ?, '', ?, 600, ?, ?, ?)`,
          ).run(id, username, displayName, randomAvatarColor(), hash, salt, nowIso());
          token = issueToken(id);
        });
      } catch (e) {
        if (/UNIQUE/i.test((e as Error).message)) throw new HttpError(409, 'That username is already taken');
        throw e;
      }
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
      const out: AuthResponse = { token, user: toUser(user) };
      res.status(201).json(out);
    }),
  );

  // Constant-ish work for unknown users to avoid trivial username enumeration by timing.
  const dummy = hashPassword('dummy-password');

  r.post(
    '/login',
    wrap(async (req, res) => {
      const body = isObj(req.body) ? req.body : {};
      const username = normalizeUsername(body.username);
      if (typeof body.password !== 'string' || body.password === '') throw badRequest('password is required');
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as unknown as UserRow | undefined;
      let ok = false;
      if (user) ok = await verifyPassword(body.password, user.password_hash, user.password_salt);
      else {
        const d = await dummy;
        await verifyPassword(body.password, d.hash, d.salt);
      }
      if (!user || !ok) throw new HttpError(401, 'Invalid username or password');
      const out: AuthResponse = { token: issueToken(user.id), user: toUser(user) };
      res.json(out);
    }),
  );

  return r;
}

export function usersRouter(ctx: Ctx): Router {
  const r = Router();
  const { db } = ctx;

  const findUser = (username: unknown): UserRow => findUserByName(ctx, username);

  r.get('/me', (req, res) => {
    res.json(toUser(req.user!));
  });

  r.patch(
    '/me',
    wrap((req, res) => {
      const body = isObj(req.body) ? req.body : {};
      const displayName = str(body, 'displayName', { min: 1, max: 40, optional: true });
      const bio = str(body, 'bio', { max: 280, optional: true });
      const goal = num(body, 'weeklyGoalMin', { min: 1, max: 10080, integer: true, optional: true });
      const me = req.user!;
      db.prepare('UPDATE users SET display_name = ?, bio = ?, weekly_goal_min = ? WHERE id = ?').run(
        displayName ?? me.display_name,
        bio ?? me.bio,
        goal ?? me.weekly_goal_min,
        me.id,
      );
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id) as unknown as UserRow;
      res.json(toUser(row));
    }),
  );

  r.get(
    '/users/search',
    wrap((req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      if (!q) return res.json([] as User[]);
      const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
      const like = `%${esc}%`;
      const rows = db
        .prepare(
          `SELECT * FROM users
           WHERE id != ?1 AND (username LIKE ?2 ESCAPE '\\' OR LOWER(display_name) LIKE ?2 ESCAPE '\\')
           ORDER BY (username = ?3) DESC, (username LIKE ?4 ESCAPE '\\') DESC, username LIMIT 20`,
        )
        .all(req.user!.id, like, q, `${esc}%`) as unknown as UserRow[];
      res.json(rows.map(toUser));
    }),
  );

  r.get(
    '/users/:username',
    wrap((req, res) => {
      const target = findUser(req.params.username);
      const today = parseToday(req.query.today);
      const me = req.user!;
      const count = (sql: string) => (db.prepare(sql).get(target.id) as { c: number }).c;
      // Totals only reflect sessions this viewer is allowed to see.
      const rows = db
        .prepare(
          `SELECT s.local_date, s.focus_ms FROM sessions s WHERE s.user_id = ?2 AND ${visibleSql('s')}`,
        )
        .all(me.id, target.id) as unknown as { local_date: string; focus_ms: number }[];
      const totalMs = rows.reduce((a, b) => a + b.focus_ms, 0);
      const profile: UserProfile = {
        ...toUser(target),
        followers: count('SELECT COUNT(*) AS c FROM follows WHERE followee_id = ?'),
        following: count('SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?'),
        sessionCount: rows.length,
        totalFocusMin: Math.round(totalMs / 60000),
        streakDays: computeStreaks(
          rows.map((x) => x.local_date),
          today,
        ).current,
        isFollowing: !!db
          .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?')
          .get(me.id, target.id),
        isMe: me.id === target.id,
      };
      res.json(profile);
    }),
  );

  r.post(
    '/users/:username/follow',
    wrap((req, res) => {
      const target = findUser(req.params.username);
      if (target.id === req.user!.id) throw badRequest('You cannot follow yourself');
      db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(
        req.user!.id,
        target.id,
        nowIso(),
      );
      res.json({ following: true });
    }),
  );

  r.delete(
    '/users/:username/follow',
    wrap((req, res) => {
      const target = findUser(req.params.username);
      db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user!.id, target.id);
      res.json({ following: false });
    }),
  );

  return r;
}

export function findUserByName(ctx: Ctx, username: unknown): UserRow {
  const u = ctx.db.prepare('SELECT * FROM users WHERE username = ?').get(normalizeUsername(username)) as
    | UserRow
    | undefined;
  if (!u) throw new HttpError(404, 'User not found');
  return u;
}
