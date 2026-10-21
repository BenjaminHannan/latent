import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Page, WorkSession } from '../../shared/types.js';
import { auth, JPEG, makeApp, meta, signup, type TestCtx, upload, VIDEO } from './helpers.js';

let t: TestCtx;
beforeEach(() => {
  t = makeApp();
});
afterEach(() => t.cleanup());

const mediaFiles = () => fs.readdirSync(path.join(t.dir, 'media')).sort();

describe('create session', () => {
  it('uploads video + thumbnail and returns a WorkSession', async () => {
    const u = await signup(t.app, 'alice');
    const s = await upload(t.app, u, { title: '  Study block  ', category: 'study' });
    expect(s).toMatchObject({
      title: 'Study block',
      description: 'heads down',
      category: 'study',
      visibility: 'public',
      focusMs: 3_600_000,
      frameCount: 720,
      intervalSec: 5,
      videoDurationMs: 24_000,
      localDate: '2025-03-10',
      kudos: 0,
      hasKudoed: false,
      commentCount: 0,
      user: { id: u.id, username: 'alice', displayName: 'User alice' },
    });
    expect(s.user.avatarColor).toMatch(/^#/);
    expect(s.videoUrl).toBe(`/media/${s.id}.webm`);
    expect(s.thumbnailUrl).toBe(`/media/${s.id}.jpg`);
    expect(mediaFiles()).toEqual([`${s.id}.jpg`, `${s.id}.webm`].sort());
    expect(fs.readdirSync(path.join(t.dir, 'tmp'))).toEqual([]);
  });

  it('stores mp4 with .mp4 extension and accepts mime parameters', async () => {
    const u = await signup(t.app, 'alice');
    const s = await upload(t.app, u, {}, { videoType: 'video/mp4', filename: 'v.mp4' });
    expect(s.videoUrl).toBe(`/media/${s.id}.mp4`);
    const s2 = await upload(t.app, u, {}, { videoType: 'video/webm;codecs=vp9' });
    expect(s2.videoUrl).toMatch(/\.webm$/);
  });

  it('serves media with correct type, long cache and Range support', async () => {
    const u = await signup(t.app, 'alice');
    const s = await upload(t.app, u);
    const v = await request(t.app).get(s.videoUrl).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(v.status).toBe(200);
    expect(v.headers['content-type']).toMatch(/^video\/webm/);
    expect(v.headers['cache-control']).toMatch(/max-age=31536000/);
    expect(v.headers['accept-ranges']).toBe('bytes');
    expect(Buffer.compare(v.body as Buffer, VIDEO)).toBe(0);

    const range = await request(t.app).get(s.videoUrl).set('Range', 'bytes=0-9').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(range.status).toBe(206);
    expect(range.headers['content-range']).toBe(`bytes 0-9/${VIDEO.length}`);
    expect((range.body as Buffer).length).toBe(10);

    const th = await request(t.app).get(s.thumbnailUrl).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(th.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(Buffer.compare(th.body as Buffer, JPEG)).toBe(0);

    const missing = await request(t.app).get('/media/nope.webm');
    expect(missing.status).toBe(404);
  });

  it('validates meta and files with 400 and leaves nothing behind', async () => {
    const u = await signup(t.app, 'alice');
    const post = () => request(t.app).post('/api/sessions').set(auth(u));
    const withFiles = (r: request.Test) =>
      r.attach('video', VIDEO, { filename: 'v.webm', contentType: 'video/webm' }).attach('thumbnail', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' });

    const badMetas: unknown[] = [
      meta({ category: 'gaming' as never }),
      meta({ visibility: 'friends' as never }),
      meta({ title: '' }),
      meta({ focusMs: -1 }),
      meta({ localDate: '2025-02-30' }),
      meta({ localDate: '03/10/2025' }),
      meta({ startedAt: 'yesterday' }),
      meta({ startedAt: '2025-03-10T11:00:00Z', endedAt: '2025-03-10T10:00:00Z' }),
      { ...meta(), frameCount: 1.5 },
      [],
    ];
    for (const m of badMetas) {
      const res = await withFiles(post().field('meta', JSON.stringify(m)));
      expect(res.status, JSON.stringify(m)).toBe(400);
      expect(res.body.error).toBeTruthy();
    }
    expect((await withFiles(post().field('meta', '{not json'))).status).toBe(400);
    expect((await withFiles(post())).status).toBe(400); // no meta

    // missing files
    expect((await post().field('meta', JSON.stringify(meta())).attach('thumbnail', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' })).status).toBe(400);
    expect((await post().field('meta', JSON.stringify(meta())).attach('video', VIDEO, { filename: 'v.webm', contentType: 'video/webm' })).status).toBe(400);
    // wrong mime types
    const badVideo = await post()
      .field('meta', JSON.stringify(meta()))
      .attach('video', VIDEO, { filename: 'v.avi', contentType: 'video/x-msvideo' })
      .attach('thumbnail', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' });
    expect(badVideo.status).toBe(400);
    expect(badVideo.body.error).toMatch(/video/);
    const badThumb = await post()
      .field('meta', JSON.stringify(meta()))
      .attach('video', VIDEO, { filename: 'v.webm', contentType: 'video/webm' })
      .attach('thumbnail', JPEG, { filename: 't.png', contentType: 'image/png' });
    expect(badThumb.status).toBe(400);
    const extra = await withFiles(post().field('meta', JSON.stringify(meta()))).attach('other', VIDEO, { filename: 'x.bin', contentType: 'application/octet-stream' });
    expect(extra.status).toBe(400);

    expect(mediaFiles()).toEqual([]);
    expect(fs.readdirSync(path.join(t.dir, 'tmp'))).toEqual([]);
    const list = await request(t.app).get('/api/users/alice/sessions').set(auth(u));
    expect(list.body.items).toHaveLength(0);
  });
});

describe('session CRUD', () => {
  it('PATCH by owner only; validates enums', async () => {
    const a = await signup(t.app, 'alice');
    const b = await signup(t.app, 'bobby');
    const s = await upload(t.app, a);

    const p = await request(t.app).patch(`/api/sessions/${s.id}`).set(auth(a)).send({ title: 'Renamed', visibility: 'followers', category: 'write', description: 'd' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ title: 'Renamed', visibility: 'followers', category: 'write', description: 'd' });

    expect((await request(t.app).patch(`/api/sessions/${s.id}`).set(auth(a)).send({ category: 'nope' })).status).toBe(400);
    expect((await request(t.app).patch(`/api/sessions/${s.id}`).set(auth(a)).send({ visibility: 'x' })).status).toBe(400);
    expect((await request(t.app).patch(`/api/sessions/${s.id}`).set(auth(a)).send({ title: '' })).status).toBe(400);

    const pub = await upload(t.app, a, { title: 'pub' });
    const other = await request(t.app).patch(`/api/sessions/${pub.id}`).set(auth(b)).send({ title: 'hax' });
    expect(other.status).toBe(403);
    expect((await request(t.app).delete(`/api/sessions/${pub.id}`).set(auth(b))).status).toBe(403);
    expect((await request(t.app).get(`/api/sessions/${pub.id}`).set(auth(a))).body.title).toBe('pub');
    expect((await request(t.app).get('/api/sessions/does-not-exist').set(auth(a))).status).toBe(404);
  });

  it('DELETE removes row, kudos, comments and media files', async () => {
    const a = await signup(t.app, 'alice');
    const b = await signup(t.app, 'bobby');
    const s = await upload(t.app, a);
    await request(t.app).post(`/api/sessions/${s.id}/kudos`).set(auth(b));
    await request(t.app).post(`/api/sessions/${s.id}/comments`).set(auth(b)).send({ body: 'nice' });
    expect(mediaFiles()).toHaveLength(2);

    const del = await request(t.app).delete(`/api/sessions/${s.id}`).set(auth(a));
    expect(del.status).toBe(204);
    expect(mediaFiles()).toEqual([]);
    expect((await request(t.app).get(`/api/sessions/${s.id}`).set(auth(a))).status).toBe(404);
    expect((await request(t.app).get(s.videoUrl)).status).toBe(404);
    const db = t.app.locals.db;
    expect((db.prepare('SELECT COUNT(*) c FROM kudos').get() as { c: number }).c).toBe(0);
    expect((db.prepare('SELECT COUNT(*) c FROM comments').get() as { c: number }).c).toBe(0);
    expect((await request(t.app).delete(`/api/sessions/${s.id}`).set(auth(a))).status).toBe(404);
  });
});

describe('visibility', () => {
  it('private only to owner, followers to followers, public to all authenticated', async () => {
    const owner = await signup(t.app, 'owner');
    const fan = await signup(t.app, 'fan');
    const rando = await signup(t.app, 'rando');
    await request(t.app).post('/api/users/owner/follow').set(auth(fan));

    const pub = await upload(t.app, owner, { title: 'pub', visibility: 'public', endedAt: '2025-03-10T10:00:00Z' });
    const fol = await upload(t.app, owner, { title: 'fol', visibility: 'followers', endedAt: '2025-03-10T11:00:00Z' });
    const priv = await upload(t.app, owner, { title: 'priv', visibility: 'private', endedAt: '2025-03-10T12:00:00Z' });

    const status = async (u: typeof owner, s: WorkSession) => (await request(t.app).get(`/api/sessions/${s.id}`).set(auth(u))).status;
    expect([await status(owner, pub), await status(owner, fol), await status(owner, priv)]).toEqual([200, 200, 200]);
    expect([await status(fan, pub), await status(fan, fol), await status(fan, priv)]).toEqual([200, 200, 404]);
    expect([await status(rando, pub), await status(rando, fol), await status(rando, priv)]).toEqual([200, 404, 404]);

    const titles = async (u: typeof owner) =>
      ((await request(t.app).get('/api/users/owner/sessions').set(auth(u))).body as Page<WorkSession>).items.map((i) => i.title);
    expect(await titles(owner)).toEqual(['priv', 'fol', 'pub']);
    expect(await titles(fan)).toEqual(['fol', 'pub']);
    expect(await titles(rando)).toEqual(['pub']);

    // profile counters only reflect visible sessions
    const prof = async (u: typeof owner) => (await request(t.app).get('/api/users/owner').set(auth(u))).body.sessionCount;
    expect([await prof(owner), await prof(fan), await prof(rando)]).toEqual([3, 2, 1]);

    // kudos / comments on invisible sessions are hidden too
    expect((await request(t.app).post(`/api/sessions/${priv.id}/kudos`).set(auth(fan))).status).toBe(404);
    expect((await request(t.app).get(`/api/sessions/${fol.id}/comments`).set(auth(rando))).status).toBe(404);
    expect((await request(t.app).post(`/api/sessions/${fol.id}/comments`).set(auth(rando)).send({ body: 'hi' })).status).toBe(404);
    expect((await request(t.app).post(`/api/sessions/${fol.id}/comments`).set(auth(fan)).send({ body: 'hi' })).status).toBe(201);

    // unfollowing hides followers-only content again
    await request(t.app).delete('/api/users/owner/follow').set(auth(fan));
    expect(await status(fan, fol)).toBe(404);

    // changing visibility takes effect immediately
    await request(t.app).patch(`/api/sessions/${priv.id}`).set(auth(owner)).send({ visibility: 'public' });
    expect(await status(rando, priv)).toBe(200);
  });
});

describe('feed', () => {
  it('contains me + followees only, newest first, hides private/followers appropriately', async () => {
    const me = await signup(t.app, 'me_user');
    const friend = await signup(t.app, 'friend');
    const stranger = await signup(t.app, 'stranger');
    await request(t.app).post('/api/users/friend/follow').set(auth(me));

    await upload(t.app, me, { title: 'mine-old', endedAt: '2025-03-01T10:00:00Z' });
    await upload(t.app, friend, { title: 'friend-pub', endedAt: '2025-03-02T10:00:00Z' });
    await upload(t.app, friend, { title: 'friend-fol', visibility: 'followers', endedAt: '2025-03-03T10:00:00Z' });
    await upload(t.app, friend, { title: 'friend-priv', visibility: 'private', endedAt: '2025-03-04T10:00:00Z' });
    await upload(t.app, stranger, { title: 'stranger', endedAt: '2025-03-05T10:00:00Z' });
    await upload(t.app, me, { title: 'mine-priv', visibility: 'private', endedAt: '2025-03-06T10:00:00Z' });

    const feed = await request(t.app).get('/api/feed').set(auth(me));
    expect(feed.status).toBe(200);
    expect((feed.body as Page<WorkSession>).items.map((i) => i.title)).toEqual(['mine-priv', 'friend-fol', 'friend-pub', 'mine-old']);
    expect(feed.body.nextCursor).toBeNull();

    const fr = await request(t.app).get('/api/feed').set(auth(friend));
    expect((fr.body as Page<WorkSession>).items.map((i) => i.title)).toEqual(['friend-priv', 'friend-fol', 'friend-pub']);
  });

  it('paginates 20 per page with opaque cursors, no dupes or gaps, ties broken by id', async () => {
    const u = await signup(t.app, 'alice');
    const total = 45;
    for (let i = 0; i < total; i++) {
      // 5 sessions share each endedAt to exercise the id tiebreak
      const minute = String(Math.floor(i / 5)).padStart(2, '0');
      await upload(t.app, u, { title: `s${i}`, endedAt: `2025-03-10T10:${minute}:00Z` });
    }
    const seen: WorkSession[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await request(t.app).get('/api/feed').query(cursor ? { cursor } : {}).set(auth(u));
      expect(res.status).toBe(200);
      const page = res.body as Page<WorkSession>;
      expect(page.items.length).toBeLessThanOrEqual(20);
      seen.push(...page.items);
      cursor = page.nextCursor;
      pages++;
      if (cursor) expect(() => Buffer.from(cursor!, 'base64url')).not.toThrow();
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(total);
    expect(new Set(seen.map((s) => s.id)).size).toBe(total);
    for (let i = 1; i < seen.length; i++) {
      const a = seen[i - 1]!;
      const b = seen[i]!;
      expect(a.endedAt > b.endedAt || (a.endedAt === b.endedAt && a.id > b.id)).toBe(true);
    }
    // exactly 20 -> no next cursor on a page that ends the data
    expect((await request(t.app).get('/api/feed').query({ cursor: 'garbage' }).set(auth(u))).status).toBe(400);
  });

  it('exactly 20 items yields nextCursor null', async () => {
    const u = await signup(t.app, 'alice');
    for (let i = 0; i < 20; i++) await upload(t.app, u, { endedAt: `2025-03-10T10:${String(i).padStart(2, '0')}:00Z` });
    const res = await request(t.app).get('/api/feed').set(auth(u));
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).toBeNull();
  });
});

describe('kudos', () => {
  it('is idempotent and toggles with correct counts per viewer', async () => {
    const a = await signup(t.app, 'alice');
    const b = await signup(t.app, 'bobby');
    const c = await signup(t.app, 'carol');
    const s = await upload(t.app, a);
    const url = `/api/sessions/${s.id}/kudos`;

    expect((await request(t.app).post(url).set(auth(b))).body).toEqual({ kudos: 1, hasKudoed: true });
    expect((await request(t.app).post(url).set(auth(b))).body).toEqual({ kudos: 1, hasKudoed: true });
    expect((await request(t.app).post(url).set(auth(c))).body).toEqual({ kudos: 2, hasKudoed: true });

    const asB = await request(t.app).get(`/api/sessions/${s.id}`).set(auth(b));
    expect(asB.body).toMatchObject({ kudos: 2, hasKudoed: true });
    const asA = await request(t.app).get(`/api/sessions/${s.id}`).set(auth(a));
    expect(asA.body).toMatchObject({ kudos: 2, hasKudoed: false });

    expect((await request(t.app).delete(url).set(auth(b))).body).toEqual({ kudos: 1, hasKudoed: false });
    expect((await request(t.app).delete(url).set(auth(b))).body).toEqual({ kudos: 1, hasKudoed: false });
    expect((await request(t.app).get('/api/sessions/nope/kudos')).status).toBe(401);
    expect((await request(t.app).post('/api/sessions/nope/kudos').set(auth(b))).status).toBe(404);
  });
});

describe('comments', () => {
  it('creates, lists in order, validates, and updates commentCount', async () => {
    const a = await signup(t.app, 'alice');
    const b = await signup(t.app, 'bobby');
    const s = await upload(t.app, a);
    const url = `/api/sessions/${s.id}/comments`;

    const c1 = await request(t.app).post(url).set(auth(b)).send({ body: '  great focus!  ' });
    expect(c1.status).toBe(201);
    expect(c1.body).toMatchObject({ sessionId: s.id, body: 'great focus!', user: { username: 'bobby', id: b.id } });
    expect(c1.body.id).toBeTruthy();
    expect(Date.parse(c1.body.createdAt)).not.toBeNaN();
    await request(t.app).post(url).set(auth(a)).send({ body: 'thanks' });
    await request(t.app).post(url).set(auth(b)).send({ body: 'third' });

    const list = await request(t.app).get(url).set(auth(a));
    expect(list.status).toBe(200);
    expect(list.body.map((c: { body: string }) => c.body)).toEqual(['great focus!', 'thanks', 'third']);

    expect((await request(t.app).post(url).set(auth(b)).send({ body: '   ' })).status).toBe(400);
    expect((await request(t.app).post(url).set(auth(b)).send({})).status).toBe(400);
    expect((await request(t.app).post(url).set(auth(b)).send({ body: 'x'.repeat(1001) })).status).toBe(400);

    const sess = await request(t.app).get(`/api/sessions/${s.id}`).set(auth(a));
    expect(sess.body.commentCount).toBe(3);
  });
});
