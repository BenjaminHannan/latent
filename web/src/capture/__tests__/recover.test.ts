import { beforeEach, describe, expect, it } from 'vitest';
import { markActive, unmarkActive } from '../active';
import { addFrame, getSessionMeta, putSessionMeta } from '../db';
import { deleteFrames, listRecoverableSessions, loadFrames, markSessionSaved } from '../index';
import { renderTimelapse, RenderUnsupportedError, formatElapsed } from '../render';
import { fakeBlob, resetDb } from './helpers';

async function seed(id: string, frames: number, startedAt: string, status: 'recording' | 'complete' | 'saved' = 'complete') {
  await putSessionMeta({ id, startedAt, intervalSec: 5, frameCount: 0, bytes: 0, status });
  for (let i = 0; i < frames; i++) await addFrame(id, i, fakeBlob(10));
}

describe('recoverable sessions', () => {
  beforeEach(resetDb);

  it('lists unsaved sessions with >=1 frame, newest first', async () => {
    await seed('old', 3, '2026-01-01T10:00:00.000Z', 'recording');
    await seed('new', 2, '2026-01-02T10:00:00.000Z');
    await seed('empty', 0, '2026-01-03T10:00:00.000Z');
    await seed('saved', 4, '2026-01-04T10:00:00.000Z', 'saved');
    expect(await listRecoverableSessions()).toEqual([
      { id: 'new', frames: 2, startedAt: '2026-01-02T10:00:00.000Z' },
      { id: 'old', frames: 3, startedAt: '2026-01-01T10:00:00.000Z' },
    ]);
  });

  it('excludes the session currently being recorded by this page', async () => {
    await seed('live', 2, '2026-01-01T10:00:00.000Z', 'recording');
    markActive('live');
    expect(await listRecoverableSessions()).toEqual([]);
    unmarkActive('live');
    expect(await listRecoverableSessions()).toHaveLength(1);
  });

  it('markSessionSaved hides the session; deleteFrames removes everything', async () => {
    await seed('a', 2, '2026-01-01T10:00:00.000Z');
    await markSessionSaved('a');
    expect(await listRecoverableSessions()).toEqual([]);
    expect((await getSessionMeta('a'))?.status).toBe('saved');
    expect((await loadFrames('a')).length).toBe(2);
    await deleteFrames('a');
    expect(await getSessionMeta('a')).toBeUndefined();
    expect(await loadFrames('a')).toEqual([]);
  });

  it('deleteFrames makes an unsaved session disappear from recovery', async () => {
    await seed('a', 2, '2026-01-01T10:00:00.000Z');
    await deleteFrames('a');
    expect(await listRecoverableSessions()).toEqual([]);
  });
});

describe('render', () => {
  it('throws RenderUnsupportedError (code UNSUPPORTED) without MediaRecorder', async () => {
    expect(typeof MediaRecorder).toBe('undefined');
    const err = await renderTimelapse('x').catch((e) => e);
    expect(err).toBeInstanceOf(RenderUnsupportedError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('UNSUPPORTED');
  });

  it('formatElapsed', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(3725)).toBe('1:02:05');
  });
});
