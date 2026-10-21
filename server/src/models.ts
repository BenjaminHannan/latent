import type { Category, User, Visibility, WorkSession } from '../../shared/types.js';
import type { UserRow } from './auth.js';
import type { Db } from './db.js';
import { HttpError } from './util.js';

export interface Ctx {
  db: Db;
  mediaDir: string;
  tmpDir: string;
}

export const toUser = (r: UserRow): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  bio: r.bio,
  avatarColor: r.avatar_color,
  weeklyGoalMin: r.weekly_goal_min,
  createdAt: r.created_at,
});

export type UserBrief = Pick<User, 'id' | 'username' | 'displayName' | 'avatarColor'>;

export interface SessionRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: Category;
  visibility: Visibility;
  started_at: string;
  ended_at: string;
  focus_ms: number;
  frame_count: number;
  interval_sec: number;
  video_duration_ms: number;
  local_date: string;
  video_file: string;
  thumb_file: string;
  created_at: string;
  username: string;
  display_name: string;
  avatar_color: string;
  kudos_count: number;
  has_kudoed: number;
  comment_count: number;
}

/**
 * SQL fragment: session alias `a` is visible to viewer bound as ?1.
 * private -> owner only; followers -> owner + followers; public -> any authenticated user.
 */
export const visibleSql = (a: string) =>
  `(${a}.user_id = ?1 OR ${a}.visibility = 'public' OR (${a}.visibility = 'followers' AND EXISTS ` +
  `(SELECT 1 FROM follows vf WHERE vf.follower_id = ?1 AND vf.followee_id = ${a}.user_id)))`;

/** Base SELECT for WorkSession rows. The viewer is bound as ?1. */
export const SESSION_SELECT = `
SELECT s.*, u.username, u.display_name, u.avatar_color,
  (SELECT COUNT(*) FROM kudos k WHERE k.session_id = s.id) AS kudos_count,
  EXISTS (SELECT 1 FROM kudos k WHERE k.session_id = s.id AND k.user_id = ?1) AS has_kudoed,
  (SELECT COUNT(*) FROM comments c WHERE c.session_id = s.id) AS comment_count
FROM sessions s JOIN users u ON u.id = s.user_id`;

export const toWorkSession = (r: SessionRow): WorkSession => ({
  id: r.id,
  user: { id: r.user_id, username: r.username, displayName: r.display_name, avatarColor: r.avatar_color },
  title: r.title,
  description: r.description,
  category: r.category,
  visibility: r.visibility,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  focusMs: r.focus_ms,
  frameCount: r.frame_count,
  intervalSec: r.interval_sec,
  videoDurationMs: r.video_duration_ms,
  localDate: r.local_date,
  videoUrl: r.video_file ? `/media/${r.video_file}` : '',
  thumbnailUrl: r.thumb_file ? `/media/${r.thumb_file}` : '',
  kudos: r.kudos_count,
  hasKudoed: !!r.has_kudoed,
  commentCount: r.comment_count,
  createdAt: r.created_at,
});

/** Fetch a session as seen by `viewerId`; undefined if missing or not visible to them. */
export function getVisibleSessionRow(ctx: Ctx, id: string, viewerId: string): SessionRow | undefined {
  return ctx.db
    .prepare(`${SESSION_SELECT} WHERE s.id = ?2 AND ${visibleSql('s')}`)
    .get(viewerId, id) as SessionRow | undefined;
}

export function requireVisibleSession(ctx: Ctx, id: string, viewerId: string): SessionRow {
  const row = getVisibleSessionRow(ctx, id, viewerId);
  if (!row) throw new HttpError(404, 'Session not found');
  return row;
}

export function encodeCursor(endedAt: string, id: string): string {
  return Buffer.from(`${endedAt}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { endedAt: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const i = decoded.indexOf('|');
  if (i <= 0 || i === decoded.length - 1) throw new HttpError(400, 'Invalid cursor');
  return { endedAt: decoded.slice(0, i), id: decoded.slice(i + 1) };
}

export const PAGE_SIZE = 20;

/**
 * Run a paginated session query. `where` is an extra SQL condition (may use ?1 = viewer and
 * ?3.. for extra params, passed as `extra`). Ordered by ended_at desc, id desc.
 */
export function pageSessions(
  ctx: Ctx,
  viewerId: string,
  where: string,
  extra: (string | number)[],
  cursor: unknown,
) {
  let cursorSql = '';
  const params: (string | number)[] = [viewerId];
  // ?2 is reserved by callers that use it; to keep numbering simple, extras start at ?2.
  params.push(...extra);
  if (cursor !== undefined && cursor !== '') {
    if (typeof cursor !== 'string') throw new HttpError(400, 'Invalid cursor');
    const c = decodeCursor(cursor);
    const a = params.length + 1;
    cursorSql = ` AND (s.ended_at < ?${a} OR (s.ended_at = ?${a} AND s.id < ?${a + 1}))`;
    params.push(c.endedAt, c.id);
  }
  const rows = ctx.db
    .prepare(
      `${SESSION_SELECT} WHERE ${visibleSql('s')} AND ${where}${cursorSql} ` +
        `ORDER BY s.ended_at DESC, s.id DESC LIMIT ${PAGE_SIZE + 1}`,
    )
    .all(...params) as unknown as SessionRow[];
  const hasMore = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);
  const last = items[items.length - 1];
  return {
    items: items.map(toWorkSession),
    nextCursor: hasMore && last ? encodeCursor(last.ended_at, last.id) : null,
  };
}
