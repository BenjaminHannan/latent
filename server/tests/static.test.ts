import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('web app serving', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it('serves web/dist with SPA fallback but keeps /api and /media as JSON 404s', async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-d-'));
    const web = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-w-'));
    dirs.push(data, web);
    fs.writeFileSync(path.join(web, 'index.html'), '<html>spa</html>');
    fs.mkdirSync(path.join(web, 'assets'));
    fs.writeFileSync(path.join(web, 'assets', 'app.js'), 'console.log(1)');
    const app = createApp({ dataDir: data, webDir: web });

    expect((await request(app).get('/')).text).toContain('spa');
    expect((await request(app).get('/profile/ava')).text).toContain('spa');
    expect((await request(app).get('/assets/app.js')).headers['content-type']).toMatch(/javascript/);
    const api = await request(app).get('/api/missing');
    expect(api.status).toBe(401); // auth first
    const media = await request(app).get('/media/missing.webm');
    expect(media.status).toBe(404);
    expect(media.body.error).toBeTruthy();
    app.locals.close();
  });

  it('works with :memory: data dir and no web dir', async () => {
    const app = createApp({ dataDir: ':memory:', webDir: null });
    const res = await request(app).post('/api/auth/signup').send({ username: 'memuser', displayName: 'M', password: 'secret1' });
    expect(res.status).toBe(201);
    expect((await request(app).get('/')).status).toBe(404);
    app.locals.close();
  });
});
