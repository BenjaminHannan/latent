import type { SessionMeta } from './types';

export const DB_NAME = 'latent-capture';
const DB_VERSION = 1;
const SESSIONS = 'sessions';
const FRAMES = 'frames';

interface FrameRecord {
  sessionId: string;
  index: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSIONS)) db.createObjectStore(SESSIONS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(FRAMES)) db.createObjectStore(FRAMES, { keyPath: ['sessionId', 'index'] });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Close the cached connection (mainly for tests). */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const p = dbPromise;
  dbPromise = null;
  try {
    (await p).close();
  } catch {
    /* ignore */
  }
}

/** Close and delete the whole database (tests / "reset"). */
export async function deleteDatabase(): Promise<void> {
  await closeDb();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

function frameRange(sessionId: string): IDBKeyRange {
  return IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]);
}

export async function putSessionMeta(meta: SessionMeta): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SESSIONS, 'readwrite');
  tx.objectStore(SESSIONS).put(meta);
  await txDone(tx);
}

export async function getSessionMeta(id: string): Promise<SessionMeta | undefined> {
  const db = await openDb();
  const tx = db.transaction(SESSIONS, 'readonly');
  return (await reqP(tx.objectStore(SESSIONS).get(id))) as SessionMeta | undefined;
}

export async function listSessionMetas(): Promise<SessionMeta[]> {
  const db = await openDb();
  const tx = db.transaction(SESSIONS, 'readonly');
  return (await reqP(tx.objectStore(SESSIONS).getAll())) as SessionMeta[];
}

/** Merge `patch` into an existing session record. Returns the updated record (undefined if missing). */
export async function updateSessionMeta(
  id: string,
  patch: Partial<Omit<SessionMeta, 'id'>>,
): Promise<SessionMeta | undefined> {
  const db = await openDb();
  const tx = db.transaction(SESSIONS, 'readwrite');
  const store = tx.objectStore(SESSIONS);
  const cur = (await reqP(store.get(id))) as SessionMeta | undefined;
  if (!cur) {
    await txDone(tx);
    return undefined;
  }
  const next: SessionMeta = { ...cur, ...patch, id };
  store.put(next);
  await txDone(tx);
  return next;
}

/**
 * Atomically store a frame and bump the session's frameCount / bytes (/ focusMs).
 * frameCount becomes max(existing, index + 1).
 */
export async function addFrame(
  sessionId: string,
  index: number,
  blob: Blob,
  focusMs?: number,
): Promise<SessionMeta> {
  const db = await openDb();
  const tx = db.transaction([SESSIONS, FRAMES], 'readwrite');
  const sessions = tx.objectStore(SESSIONS);
  const frames = tx.objectStore(FRAMES);
  const meta = (await reqP(sessions.get(sessionId))) as SessionMeta | undefined;
  if (!meta) {
    tx.abort();
    throw new Error(`Capture session ${sessionId} not found`);
  }
  const rec: FrameRecord = { sessionId, index, blob };
  frames.put(rec);
  const next: SessionMeta = {
    ...meta,
    frameCount: Math.max(meta.frameCount, index + 1),
    bytes: meta.bytes + blob.size,
    ...(focusMs !== undefined ? { focusMs } : {}),
  };
  sessions.put(next);
  await txDone(tx);
  return next;
}

export async function getFrame(sessionId: string, index: number): Promise<Blob | undefined> {
  const db = await openDb();
  const tx = db.transaction(FRAMES, 'readonly');
  const rec = (await reqP(tx.objectStore(FRAMES).get([sessionId, index]))) as FrameRecord | undefined;
  return rec?.blob;
}

/** All frames of a session in capture order. */
export async function getFrames(sessionId: string): Promise<Blob[]> {
  const db = await openDb();
  const tx = db.transaction(FRAMES, 'readonly');
  const recs = (await reqP(tx.objectStore(FRAMES).getAll(frameRange(sessionId)))) as FrameRecord[];
  return recs.sort((a, b) => a.index - b.index).map((r) => r.blob);
}

export async function countFrames(sessionId: string): Promise<number> {
  const db = await openDb();
  const tx = db.transaction(FRAMES, 'readonly');
  return reqP(tx.objectStore(FRAMES).count(frameRange(sessionId)));
}

/** Delete every frame and the session record. */
export async function deleteSessionData(sessionId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([SESSIONS, FRAMES], 'readwrite');
  tx.objectStore(FRAMES).delete(frameRange(sessionId));
  tx.objectStore(SESSIONS).delete(sessionId);
  await txDone(tx);
}
