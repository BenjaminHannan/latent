import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request } from 'express';
import multer from 'multer';
import type { Category, Comment, Visibility } from '../../../shared/types.js';
import { tx } from '../db.js';
import {
  type Ctx,
  getVisibleSessionRow,
  pageSessions,
  requireVisibleSession,
  toWorkSession,
} from '../models.js';
import { CATEGORIES, isValidYmd, VISIBILITIES } from '../stats.js';
import { badRequest, HttpError, isoDate, isObj, nowIso, num, oneOf, str, wrap } from '../util.js';
import { findUserByName } from './users.js';

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const baseMime = (m: string) => m.split(';')[0]!.trim().toLowerCase();

function rmQuiet(file: string | undefined) {
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}

function parseMeta(raw: unknown) {
  if (typeof raw !== 'string') throw badRequest('meta field (JSON string) is required');
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    throw badRequest('meta must be valid JSON');
  }
  if (!isObj(m)) throw badRequest('meta must be a JSON object');
  const startedAt = isoDate(m, 'startedAt');
  const endedAt = isoDate(m, 'endedAt');
  if (endedAt < startedAt) throw badRequest('endedAt must not be before startedAt');
  const localDate = str(m, 'localDate', { min: 1, max: 10 })!;
  if (!isValidYmd(localDate)) throw badRequest('localDate must be a valid YYYY-MM-DD date');
  return {
    title: str(m, 'title', { min: 1, max: 100 })!,
    description: str(m, 'description', { max: 2000, optional: true }) ?? '',
    category: oneOf<Category>(m, 'category', CATEGORIES)!,
    visibility: oneOf<Visibility>(m, 'visibility', VISIBILITIES)!,
    startedAt,
    endedAt,
    focusMs: num(m, 'focusMs', { min: 0, max: 7 * 86_400_000, integer: true })!,
    frameCount: num(m, 'frameCount', { min: 0, max: 10_000_000, integer: true })!,
    intervalSec: num(m, 'intervalSec', { min: 0.001, max: 86_400 })!,
    videoDurationMs: num(m, 'videoDurationMs', { min: 0, max: 86_400_000, integer: true })!,
    localDate,
  };
}

export function sessionsRouter(ctx: Ctx): Router {
  const r = Router();
  const { db } = ctx;

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, ctx.tmpDir),
      filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
    }),
    limits: { fileSize: MAX_VIDEO_BYTES, files: 2, fields: 4, fieldSize: 256 * 1024 },
    fileFilter: (_req, file, cb) => {
      const mt = baseMime(file.mimetype);
      if (file.fieldname === 'video') {
        if (mt === 'video/webm' || mt === 'video/mp4') return cb(null, true);
        return cb(badRequest('video must be video/webm or video/mp4'));
      }
      if (file.fieldname === 'thumbnail') {
        if (mt === 'image/jpeg') return cb(null, true);
        return cb(badRequest('thumbnail must be image/jpeg'));
      }
      return cb(badRequest(`Unexpected file field "${file.fieldname}"`));
    },
  }).fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]);

  r.post('/sessions', upload, (req, res, next) => {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const video = files.video?.[0];
    const thumb = files.thumbnail?.[0];
    const cleanup = () => {
      rmQuiet(video?.path);
      rmQuiet(thumb?.path);
    };
    const movedTo: string[] = [];
    try {
      const meta = parseMeta(req.body?.meta);
      if (!video) throw badRequest('video file is required');
      if (!thumb) throw badRequest('thumbnail file is required');
      const id = crypto.randomUUID();
      const ext = baseMime(video.mimetype) === 'video/mp4' ? 'mp4' : 'webm';
      const videoFile = `${id}.${ext}`;
      const thumbFile = `${id}.jpg`;
      fs.renameSync(video.path, path.join(ctx.mediaDir, videoFile));
      movedTo.push(path.join(ctx.mediaDir, videoFile));
      fs.renameSync(thumb.path, path.join(ctx.mediaDir, thumbFile));
      movedTo.push(path.join(ctx.mediaDir, thumbFile));
      db.prepare(
        `INSERT INTO sessions (id, user_id, title, description, category, visibility, started_at, ended_at,
           focus_ms, frame_count, interval_sec, video_duration_ms, local_date, video_file, thumb_file, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, req.user!.id, meta.title, meta.description, meta.category, meta.visibility, meta.startedAt, meta.endedAt,
        meta.focusMs, meta.frameCount, meta.intervalSec, meta.videoDurationMs, meta.localDate, videoFile, thumbFile, nowIso(),
      );
      res.status(201).json(toWorkSession(getVisibleSessionRow(ctx, id, req.user!.id)!));
    } catch (e) {
      cleanup();
      movedTo.forEach(rmQuiet);
      next(e);
    }
  });

  r.get(
    '/sessions/:id',
    wrap((req, res) => {
      res.json(toWorkSession(requireVisibleSession(ctx, req.params.id!, req.user!.id)));
    }),
  );

  r.patch(
    '/sessions/:id',
    wrap((req, res) => {
      const me = req.user!;
      const row = requireVisibleSession(ctx, req.params.id!, me.id);
      if (row.user_id !== me.id) throw new HttpError(403, 'Only the owner can edit this session');
      const body = isObj(req.body) ? req.body : {};
      const title = str(body, 'title', { min: 1, max: 100, optional: true });
      const description = str(body, 'description', { max: 2000, optional: true });
      const category = oneOf<Category>(body, 'category', CATEGORIES, true);
      const visibility = oneOf<Visibility>(body, 'visibility', VISIBILITIES, true);
      db.prepare('UPDATE sessions SET title = ?, description = ?, category = ?, visibility = ? WHERE id = ?').run(
        title ?? row.title,
        description ?? row.description,
        category ?? row.category,
        visibility ?? row.visibility,
        row.id,
      );
      res.json(toWorkSession(getVisibleSessionRow(ctx, row.id, me.id)!));
    }),
  );

  r.delete(
    '/sessions/:id',
    wrap((req, res) => {
      const me = req.user!;
      const row = requireVisibleSession(ctx, req.params.id!, me.id);
      if (row.user_id !== me.id) throw new HttpError(403, 'Only the owner can delete this session');
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id); // kudos/comments cascade
      for (const f of [row.video_file, row.thumb_file]) {
        if (f) rmQuiet(path.join(ctx.mediaDir, path.basename(f)));
      }
      res.status(204).end();
    }),
  );

  r.get(
    '/feed',
    wrap((req, res) => {
      const me = req.user!;
      res.json(
        pageSessions(
          ctx,
          me.id,
          '(s.user_id = ?1 OR s.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?1))',
          [],
          req.query.cursor,
        ),
      );
    }),
  );

  r.get(
    '/users/:username/sessions',
    wrap((req, res) => {
      const target = findUserByName(ctx, req.params.username);
      res.json(pageSessions(ctx, req.user!.id, 's.user_id = ?2', [target.id], req.query.cursor));
    }),
  );

  // --- kudos ---
  const kudosState = (sessionId: string, viewerId: string) => {
    const kudos = (db.prepare('SELECT COUNT(*) AS c FROM kudos WHERE session_id = ?').get(sessionId) as { c: number }).c;
    const hasKudoed = !!db.prepare('SELECT 1 FROM kudos WHERE session_id = ? AND user_id = ?').get(sessionId, viewerId);
    return { kudos, hasKudoed };
  };

  r.post(
    '/sessions/:id/kudos',
    wrap((req, res) => {
      const row = requireVisibleSession(ctx, req.params.id!, req.user!.id);
      db.prepare('INSERT OR IGNORE INTO kudos (session_id, user_id, created_at) VALUES (?, ?, ?)').run(
        row.id,
        req.user!.id,
        nowIso(),
      );
      res.json(kudosState(row.id, req.user!.id));
    }),
  );

  r.delete(
    '/sessions/:id/kudos',
    wrap((req, res) => {
      const row = requireVisibleSession(ctx, req.params.id!, req.user!.id);
      db.prepare('DELETE FROM kudos WHERE session_id = ? AND user_id = ?').run(row.id, req.user!.id);
      res.json(kudosState(row.id, req.user!.id));
    }),
  );

  // --- comments ---
  interface CommentRow {
    id: string;
    session_id: string;
    body: string;
    created_at: string;
    user_id: string;
    username: string;
    display_name: string;
    avatar_color: string;
  }
  const toComment = (c: CommentRow): Comment => ({
    id: c.id,
    sessionId: c.session_id,
    user: { id: c.user_id, username: c.username, displayName: c.display_name, avatarColor: c.avatar_color },
    body: c.body,
    createdAt: c.created_at,
  });
  const COMMENT_SELECT = `SELECT c.id, c.session_id, c.body, c.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_color
    FROM comments c JOIN users u ON u.id = c.user_id`;

  r.get(
    '/sessions/:id/comments',
    wrap((req, res) => {
      const row = requireVisibleSession(ctx, req.params.id!, req.user!.id);
      const rows = db
        .prepare(`${COMMENT_SELECT} WHERE c.session_id = ? ORDER BY c.created_at ASC, c.rowid ASC`)
        .all(row.id) as unknown as CommentRow[];
      res.json(rows.map(toComment));
    }),
  );

  r.post(
    '/sessions/:id/comments',
    wrap((req: Request, res) => {
      const row = requireVisibleSession(ctx, req.params.id!, req.user!.id);
      const body = isObj(req.body) ? req.body : {};
      const text = str(body, 'body', { min: 1, max: 1000 })!;
      const id = crypto.randomUUID();
      tx(db, () => {
        db.prepare('INSERT INTO comments (id, session_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(
          id,
          row.id,
          req.user!.id,
          text,
          nowIso(),
        );
      });
      const created = db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(id) as unknown as CommentRow;
      res.status(201).json(toComment(created));
    }),
  );

  return r;
}
