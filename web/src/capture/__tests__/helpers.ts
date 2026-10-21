import { deleteDatabase } from '../db';

export async function resetDb(): Promise<void> {
  await deleteDatabase();
}

/** A tiny fake "JPEG" blob of the given size. */
export function fakeBlob(size = 10): Blob {
  return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}
