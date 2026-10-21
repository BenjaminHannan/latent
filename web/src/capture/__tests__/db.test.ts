import { beforeEach, describe, expect, it } from 'vitest';
import {
  addFrame,
  countFrames,
  deleteSessionData,
  getFrame,
  getFrames,
  getSessionMeta,
  listSessionMetas,
  putSessionMeta,
  updateSessionMeta,
} from '../db';
import type { SessionMeta } from '../types';
import { fakeBlob, resetDb } from './helpers';

const meta = (id: string, extra: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  startedAt: '2026-01-01T10:00:00.000Z',
  intervalSec: 5,
  frameCount: 0,
  bytes: 0,
  status: 'recording',
  ...extra,
});

describe('db', () => {
  beforeEach(resetDb);

  it('creates the latent-capture db with sessions and frames stores', async () => {
    await putSessionMeta(meta('a'));
    const dbs = await indexedDB.databases();
    expect(dbs.some((d) => d.name === 'latent-capture')).toBe(true);
  });

  it('stores and reads session meta', async () => {
    await putSessionMeta(meta('a'));
    expect(await getSessionMeta('a')).toMatchObject({ id: 'a', status: 'recording', intervalSec: 5 });
    expect(await getSessionMeta('nope')).toBeUndefined();
    expect((await listSessionMetas()).map((m) => m.id)).toEqual(['a']);
  });

  it('updateSessionMeta merges and returns undefined for missing ids', async () => {
    await putSessionMeta(meta('a'));
    const next = await updateSessionMeta('a', { status: 'complete', endedAt: 'x' });
    expect(next).toMatchObject({ id: 'a', status: 'complete', endedAt: 'x', intervalSec: 5 });
    expect(await updateSessionMeta('missing', { status: 'saved' })).toBeUndefined();
  });

  it('addFrame persists a frame and bumps frameCount/bytes/focusMs atomically', async () => {
    await putSessionMeta(meta('a'));
    const m1 = await addFrame('a', 0, fakeBlob(100), 0);
    expect(m1).toMatchObject({ frameCount: 1, bytes: 100, focusMs: 0 });
    const m2 = await addFrame('a', 1, fakeBlob(50), 5000);
    expect(m2).toMatchObject({ frameCount: 2, bytes: 150, focusMs: 5000 });
    expect(await getSessionMeta('a')).toMatchObject({ frameCount: 2, bytes: 150 });
    expect(await countFrames('a')).toBe(2);
    expect(await getFrame('a', 1)).toBeDefined();
    expect(await getFrame('a', 5)).toBeUndefined();
  });

  it('addFrame rejects (and stores nothing) for an unknown session', async () => {
    await expect(addFrame('ghost', 0, fakeBlob())).rejects.toThrow();
    expect(await countFrames('ghost')).toBe(0);
  });

  it('getFrames returns frames in index order and isolates sessions', async () => {
    await putSessionMeta(meta('a'));
    await putSessionMeta(meta('b'));
    for (const i of [2, 0, 10, 1]) await addFrame('a', i, fakeBlob(i + 1));
    await addFrame('b', 0, fakeBlob(1));
    expect((await getFrames('a')).length).toBe(4);
    expect(await countFrames('a')).toBe(4);
    expect(await countFrames('b')).toBe(1);
  });

  it('deleteSessionData removes frames and meta for only that session', async () => {
    await putSessionMeta(meta('a'));
    await putSessionMeta(meta('b'));
    await addFrame('a', 0, fakeBlob());
    await addFrame('b', 0, fakeBlob());
    await deleteSessionData('a');
    expect(await getSessionMeta('a')).toBeUndefined();
    expect(await countFrames('a')).toBe(0);
    expect(await countFrames('b')).toBe(1);
    expect(await getSessionMeta('b')).toBeDefined();
  });
});
