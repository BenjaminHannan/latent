import fs from 'node:fs';
import path from 'node:path';

/** Walk up from this module until we find the server package root (the dir with package.json). */
export function serverRoot(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function defaultDataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(serverRoot(), 'data');
}

/** Location of the built web app (../web/dist relative to server root) if it exists. */
export function defaultWebDir(): string | null {
  const p = path.resolve(serverRoot(), '..', 'web', 'dist');
  return fs.existsSync(path.join(p, 'index.html')) ? p : null;
}
