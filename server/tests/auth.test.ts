import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth, makeApp, signup, type TestCtx } from './helpers.js';

let t: TestCtx;
beforeEach(() => {
  t = makeApp();
});
afterEach(() => t.cleanup());

describe('auth', () => {
  it('signs up, normalizes username, returns token + user', async () => {
    const res = await request(t.app)
      .post('/api/auth/signup')
      .send({ username: '  Alice_01 ', displayName: 'Alice', password: 'hunter22' });
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.user).toMatchObject({ username: 'alice_01', displayName: 'Alice', bio: '', weeklyGoalMin: 600 });
    expect(res.body.user.avatarColor).toMatch(/^#[0-9A-F]{6}$/i);
    expect(res.body.user.password_hash).toBeUndefined();
    expect(Date.parse(res.body.user.createdAt)).not.toBeNaN();
  });

  it('rejects invalid signups with 400 and clear messages', async () => {
    const bad = [
      { username: 'ab', displayName: 'x', password: 'secret1' },
      { username: 'a'.repeat(21), displayName: 'x', password: 'secret1' },
      { username: 'has space', displayName: 'x', password: 'secret1' },
      { username: 'dash-ed', displayName: 'x', password: 'secret1' },
      { username: 'search', displayName: 'x', password: 'secret1' },
      { username: 'okname', displayName: 'x', password: '12345' },
      { username: 'okname', displayName: '', password: 'secret1' },
      { username: 'okname', password: 'secret1' },
      {},
    ];
    for (const body of bad) {
      const res = await request(t.app).post('/api/auth/signup').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof res.body.error).toBe('string');
    }
  });

  it('rejects duplicate usernames case-insensitively with 409', async () => {
    await signup(t.app, 'dupe');
    const res = await request(t.app).post('/api/auth/signup').send({ username: 'DUPE', displayName: 'x', password: 'secret1' });
    expect(res.status).toBe(409);
  });

  it('logs in with right password, rejects wrong password and unknown user', async () => {
    await signup(t.app, 'bob', 'correct-horse');
    const ok = await request(t.app).post('/api/auth/login').send({ username: 'BOB', password: 'correct-horse' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.username).toBe('bob');
    expect(ok.body.token).toMatch(/^[0-9a-f]{64}$/);

    const wrong = await request(t.app).post('/api/auth/login').send({ username: 'bob', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBeTruthy();

    const unknown = await request(t.app).post('/api/auth/login').send({ username: 'ghost', password: 'whatever' });
    expect(unknown.status).toBe(401);

    const missing = await request(t.app).post('/api/auth/login').send({ username: 'bob' });
    expect(missing.status).toBe(400);
  });

  it('requires auth on /api routes with JSON 401', async () => {
    for (const [method, url] of [
      ['get', '/api/me'],
      ['get', '/api/feed'],
      ['get', '/api/stats/me'],
      ['get', '/api/leaderboard'],
      ['get', '/api/users/search?q=a'],
      ['post', '/api/sessions'],
    ] as const) {
      const res = await request(t.app)[method](url);
      expect(res.status, url).toBe(401);
      expect(res.headers['content-type']).toMatch(/json/);
      expect(res.body.error).toBeTruthy();
    }
    const badTok = await request(t.app).get('/api/me').set('Authorization', 'Bearer deadbeef');
    expect(badTok.status).toBe(401);
    const wrongScheme = await request(t.app).get('/api/me').set('Authorization', 'Basic abc');
    expect(wrongScheme.status).toBe(401);
  });

  it('returns JSON 404 for unknown api routes and invalid JSON bodies as 400', async () => {
    const u = await signup(t.app, 'carol');
    const nf = await request(t.app).get('/api/nope').set(auth(u));
    expect(nf.status).toBe(404);
    expect(nf.body.error).toBeTruthy();
    const badJson = await request(t.app).post('/api/auth/login').set('Content-Type', 'application/json').send('{oops');
    expect(badJson.status).toBe(400);
    expect(badJson.body.error).toMatch(/json/i);
  });
});

describe('profile', () => {
  it('GET /api/me and PATCH /api/me', async () => {
    const u = await signup(t.app, 'dana');
    const me = await request(t.app).get('/api/me').set(auth(u));
    expect(me.body.username).toBe('dana');

    const patched = await request(t.app)
      .patch('/api/me')
      .set(auth(u))
      .send({ displayName: 'Dana D', bio: 'writes things', weeklyGoalMin: 300 });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ displayName: 'Dana D', bio: 'writes things', weeklyGoalMin: 300, username: 'dana' });

    const partial = await request(t.app).patch('/api/me').set(auth(u)).send({ bio: 'new bio' });
    expect(partial.body).toMatchObject({ displayName: 'Dana D', bio: 'new bio', weeklyGoalMin: 300 });

    for (const body of [{ displayName: '' }, { weeklyGoalMin: -5 }, { weeklyGoalMin: 1.5 }, { bio: 'x'.repeat(300) }, { weeklyGoalMin: 'lots' }]) {
      const res = await request(t.app).patch('/api/me').set(auth(u)).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('search finds users by username/display name, excludes self', async () => {
    const a = await signup(t.app, 'zed_one');
    await signup(t.app, 'zed_two');
    await signup(t.app, 'other');
    const res = await request(t.app).get('/api/users/search?q=ZED').set(auth(a));
    expect(res.status).toBe(200);
    expect(res.body.map((u: { username: string }) => u.username)).toEqual(['zed_two']);
    const none = await request(t.app).get('/api/users/search?q=').set(auth(a));
    expect(none.body).toEqual([]);
    const wildcard = await request(t.app).get('/api/users/search?q=%25').set(auth(a));
    expect(wildcard.body).toEqual([]);
  });
});

describe('follows', () => {
  it('follow/unfollow with counts and isFollowing/isMe', async () => {
    const a = await signup(t.app, 'alice');
    const b = await signup(t.app, 'bobby');

    let p = await request(t.app).get('/api/users/bobby').set(auth(a));
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ followers: 0, following: 0, isFollowing: false, isMe: false, sessionCount: 0, streakDays: 0 });

    const f = await request(t.app).post('/api/users/bobby/follow').set(auth(a));
    expect(f.body).toEqual({ following: true });
    const f2 = await request(t.app).post('/api/users/bobby/follow').set(auth(a)); // idempotent
    expect(f2.body).toEqual({ following: true });

    p = await request(t.app).get('/api/users/bobby').set(auth(a));
    expect(p.body).toMatchObject({ followers: 1, isFollowing: true });
    const mine = await request(t.app).get('/api/users/alice').set(auth(a));
    expect(mine.body).toMatchObject({ following: 1, followers: 0, isMe: true });
    const fromB = await request(t.app).get('/api/users/alice').set(auth(b));
    expect(fromB.body).toMatchObject({ followers: 0, isFollowing: false });
    const bobSelf = await request(t.app).get('/api/users/bobby').set(auth(b));
    expect(bobSelf.body).toMatchObject({ followers: 1, isMe: true });

    const u = await request(t.app).delete('/api/users/bobby/follow').set(auth(a));
    expect(u.body).toEqual({ following: false });
    p = await request(t.app).get('/api/users/bobby').set(auth(a));
    expect(p.body).toMatchObject({ followers: 0, isFollowing: false });
  });

  it('cannot follow self; unknown user 404', async () => {
    const a = await signup(t.app, 'selfie');
    expect((await request(t.app).post('/api/users/selfie/follow').set(auth(a))).status).toBe(400);
    expect((await request(t.app).post('/api/users/nobody/follow').set(auth(a))).status).toBe(404);
    expect((await request(t.app).get('/api/users/nobody').set(auth(a))).status).toBe(404);
  });
});
