import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type ErrorRequestHandler, type Express } from 'express';
import multer from 'multer';
import { requireAuth } from './auth.js';
import { defaultWebDir } from './config.js';
import { type Db, openDb } from './db.js';
import type { Ctx } from './models.js';
import { sessionsRouter } from './routes/sessions.js';
import { statsRouter } from './routes/stats.js';
import { authRouter, usersRouter } from './routes/users.js';
import { HttpError } from './util.js';

export interface CreateAppOptions {
  /** Directory holding latent.db and media/. Use ':memory:' for an in-memory DB with a temp media dir. */
  dataDir: string;
  /** Built web app to serve (default: ../web/dist if it exists). Pass null to disable. */
  webDir?: string | null;
  /** Log unexpected 500 errors (default true). */
  logErrors?: boolean;
}

export type LatentApp = Express & { locals: { db: Db; dataDir: string; mediaDir: string; close(): void } };

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function createApp(opts: CreateAppOptions): LatentApp {
  const inMemory = opts.dataDir === ':memory:';
  const dataDir = inMemory ? fs.mkdtempSync(path.join(os.tmpdir(), 'latent-')) : path.resolve(opts.dataDir);
  const mediaDir = path.join(dataDir, 'media');
  const tmpDir = path.join(dataDir, 'tmp');
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const db = openDb(inMemory ? ':memory:' : path.join(dataDir, 'latent.db'));
  const ctx: Ctx = { db, mediaDir, tmpDir };

  const app = express() as LatentApp;
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.dataDir = dataDir;
  app.locals.mediaDir = mediaDir;
  app.locals.close = () => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    if (inMemory) fs.rmSync(dataDir, { recursive: true, force: true });
  };

  // Harmless CORS for local dev tools (Vite normally proxies, so this is rarely needed).
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && LOCAL_ORIGIN.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });

  // --- API ---
  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use('/auth', authRouter(ctx));
  api.use(requireAuth(db));
  api.use(usersRouter(ctx));
  api.use(sessionsRouter(ctx));
  api.use(statsRouter(ctx));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  // --- Media: immutable (ids are unique), Range-capable via express.static ---
  app.use(
    '/media',
    express.static(mediaDir, {
      maxAge: '365d',
      immutable: true,
      index: false,
      dotfiles: 'ignore',
      fallthrough: false,
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    }),
  );

  // --- Built web app (production) with SPA fallback ---
  const webDir = opts.webDir === undefined ? defaultWebDir() : opts.webDir;
  if (webDir && fs.existsSync(path.join(webDir, 'index.html'))) {
    app.use(express.static(webDir, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDir, 'index.html'));
    });
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'Not found')));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (res.headersSent) return;
    let status = 500;
    let message = 'Internal server error';
    if (err instanceof HttpError) {
      status = err.status;
      message = err.message;
    } else if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        status = 413;
        message = 'File too large (max 200MB)';
      } else {
        status = 400;
        message =
          err.code === 'LIMIT_UNEXPECTED_FILE' ? `Unexpected file field "${err.field ?? ''}"` : `Upload error: ${err.message}`;
      }
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      status = 400;
      message = 'Invalid JSON body';
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
      status = 413;
      message = 'Request body too large';
    } else if (err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number') {
      // e.g. errors from express.static (404 for missing media, 416 bad range)
      status = (err as { status: number }).status;
      message = status === 404 ? 'Not found' : (err as Error).message || 'Error';
    } else if (opts.logErrors !== false) {
      console.error(err);
    }
    res.status(status).json({ error: message });
  };
  app.use(onError);

  return app;
}
