import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp, type LatentApp } from '../src/app.js';
import type { CreateSessionInput, WorkSession } from '../../shared/types.js';

export interface TestCtx {
  app: LatentApp;
  dir: string;
  cleanup(): void;
}

export function makeApp(): TestCtx {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-test-'));
  const app = createApp({ dataDir: dir, webDir: null, logErrors: false });
  return {
    app,
    dir,
    cleanup() {
      app.locals.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface TestUser {
  token: string;
  username: string;
  id: string;
}

export async function signup(app: LatentApp, username: string, password = 'secret123'): Promise<TestUser> {
  const res = await request(app).post('/api/auth/signup').send({ username, displayName: `User ${username}`, password });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token, username: res.body.user.username, id: res.body.user.id };
}

export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` });

export function meta(overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
  // if only endedAt is overridden, start one hour before it
  if (overrides.endedAt && !overrides.startedAt) {
    overrides = { ...overrides, startedAt: new Date(Date.parse(overrides.endedAt) - 3_600_000).toISOString() };
  }
  return {
    title: 'Deep work',
    description: 'heads down',
    category: 'code',
    visibility: 'public',
    startedAt: '2025-03-10T09:00:00.000Z',
    endedAt: '2025-03-10T10:00:00.000Z',
    focusMs: 3_600_000,
    frameCount: 720,
    intervalSec: 5,
    videoDurationMs: 24_000,
    localDate: '2025-03-10',
    ...overrides,
  };
}

export const VIDEO = Buffer.from('fake-webm-bytes-0123456789'.repeat(10));
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

export async function upload(
  app: LatentApp,
  user: TestUser,
  overrides: Partial<CreateSessionInput> = {},
  opts: { videoType?: string; filename?: string } = {},
): Promise<WorkSession> {
  const res = await request(app)
    .post('/api/sessions')
    .set(auth(user))
    .field('meta', JSON.stringify(meta(overrides)))
    .attach('video', VIDEO, { filename: opts.filename ?? 'v.webm', contentType: opts.videoType ?? 'video/webm' })
    .attach('thumbnail', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' });
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as WorkSession;
}
