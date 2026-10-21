/**
 * Seed script: `npm run seed` (add `-- --reset` to wipe and recreate the demo users).
 *
 * Creates 4 demo users (ava, noah, mia, leo; password "password") who follow each other, with ~3 weeks
 * of focus sessions each, plus kudos and comments.
 *
 * Media: if `ffmpeg` is on PATH a short colored test-pattern .webm and a JPEG frame are generated per
 * category. Otherwise a tiny embedded solid-color JPEG is used as the thumbnail and sessions get
 * videoUrl === '' (the UI should show the thumbnail when videoUrl is empty).
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword } from './auth.js';
import { defaultDataDir } from './config.js';
import { openDb, tx } from './db.js';
import { CATEGORIES, dayNum, todayUtc, ymdFromDayNum } from './stats.js';
import type { Category, Visibility } from '../../shared/types.js';

// 96x54 solid-color JPEGs (one per category) used when ffmpeg is unavailable.
const FALLBACK_JPEGS: Record<Category, string> = {
  study: '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABNAAEBAAAAAAAAAAAAAAAAAAAAAwEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgANgBgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AiA0VJgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/9k=',
  code: '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABNAAEBAAAAAAAAAAAAAAAAAAAAAwEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgANgBgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AqAhmsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/9k=',
  write: '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABLAAEAAAAAAAAAAAAAAAAAAAAAAQEBAAAAAAAAAAAAAAAAAAAABxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIADYAYAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AAAl4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/2Q==',
  design: '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABNAAEBAAAAAAAAAAAAAAAAAAAAAgEBAQEAAAAAAAAAAAAAAAAAAAQHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgANgBgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AoBa0sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k=',
  music: '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABNAAEBAAAAAAAAAAAAAAAAAAAAAwEBAQEAAAAAAAAAAAAAAAAAAAQHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgANgBgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AkA0VWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//9k=',
  art: '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgANgBgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AqAGTrgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/9k=',
  other: '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABMAAEBAAAAAAAAAAAAAAAAAAAABAEBAQAAAAAAAAAAAAAAAAAAAAQQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAA2AGADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCEBclAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf/Z',
};

const USERS = [
  { username: 'ava', displayName: 'Ava Chen', bio: 'PhD student. Writing the thesis one pomodoro at a time.', color: '#FF5A1F', goal: 900 },
  { username: 'noah', displayName: 'Noah Patel', bio: 'Backend dev. Deep work before standup.', color: '#3B82F6', goal: 600 },
  { username: 'mia', displayName: 'Mia Rossi', bio: 'Illustrator + part-time student.', color: '#EC4899', goal: 480 },
  { username: 'leo', displayName: 'Leo Okafor', bio: 'Learning piano and Rust. Not at the same time.', color: '#10B981', goal: 300 },
];

const COMMENTS = [
  'Great streak!', 'Love this setup', 'Absolute machine', 'Okay I need to get back to work too',
  'That timelapse is satisfying', 'Nice focus block!', 'Keep it up', 'What were you working on?',
  'Inspiring, same time tomorrow?', 'Solid session',
];

const CATEGORY_TITLES: Record<Category, string[]> = {
  study: ['Organic chemistry review', 'Thesis reading', 'Flashcards sprint'],
  code: ['Refactoring the API', 'Bug bash', 'Side project: timelapse app'],
  write: ['Chapter draft', 'Blog post', 'Journaling and outlining'],
  design: ['Landing page mockups', 'Design system cleanup'],
  music: ['Scales and arpeggios', 'Learning a Chopin nocturne'],
  art: ['Character sketches', 'Watercolor study'],
  other: ['Admin catch-up', 'Planning the week'],
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

interface Asset {
  video?: string; // path to a source webm
  thumb: string; // path to a source jpg
}

function buildAssets(tmp: string, ffmpeg: boolean): Record<Category, Asset> {
  const out = {} as Record<Category, Asset>;
  CATEGORIES.forEach((cat, i) => {
    const thumb = path.join(tmp, `${cat}.jpg`);
    if (ffmpeg) {
      const video = path.join(tmp, `${cat}.webm`);
      const r = spawnSync(
        'ffmpeg',
        ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=15:d=3', '-vf', `hue=h=${i * 50}`,
         '-c:v', 'libvpx', '-b:v', '150k', '-an', video],
        { stdio: 'ignore' },
      );
      const t = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '1', '-i', video, '-frames:v', '1', '-q:v', '5', thumb], { stdio: 'ignore' });
      if (r.status === 0 && t.status === 0 && fs.existsSync(video) && fs.existsSync(thumb)) {
        out[cat] = { video, thumb };
        return;
      }
    }
    fs.writeFileSync(thumb, Buffer.from(FALLBACK_JPEGS[cat], 'base64'));
    out[cat] = { thumb };
  });
  return out;
}

async function main() {
  const reset = process.argv.includes('--reset');
  const dataDir = defaultDataDir();
  const mediaDir = path.join(dataDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const db = openDb(path.join(dataDir, 'latent.db'));

  const existing = db
    .prepare(`SELECT id, username FROM users WHERE username IN (${USERS.map(() => '?').join(',')})`)
    .all(...USERS.map((u) => u.username)) as unknown as { id: string; username: string }[];
  if (existing.length) {
    if (!reset) {
      console.log(`Demo users already exist (${existing.map((u) => u.username).join(', ')}). Use "npm run seed -- --reset" to recreate.`);
      db.close();
      return;
    }
    for (const u of existing) {
      const files = db.prepare('SELECT video_file, thumb_file FROM sessions WHERE user_id = ?').all(u.id) as unknown as { video_file: string; thumb_file: string }[];
      for (const f of files) for (const n of [f.video_file, f.thumb_file]) if (n) fs.rmSync(path.join(mediaDir, path.basename(n)), { force: true });
      db.prepare('DELETE FROM users WHERE id = ?').run(u.id); // cascades
    }
    console.log('Removed previous demo data.');
  }

  const ffmpeg = hasFfmpeg();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'latent-seed-'));
  const assets = buildAssets(tmp, ffmpeg);
  const haveVideo = Object.values(assets).some((a) => a.video);
  const rand = mulberry32(42);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;

  const now = new Date();
  const today = todayUtc();
  const todayN = dayNum(today)!;
  const nowIso = now.toISOString();
  const { hash, salt } = await hashPassword('password');

  const ids: Record<string, string> = {};
  const sessionIds: { id: string; userId: string; visibility: Visibility }[] = [];
  let sessionCount = 0;

  tx(db, () => {
    const created = new Date(now.getTime() - 25 * 86_400_000).toISOString();
    for (const u of USERS) {
      const id = crypto.randomUUID();
      ids[u.username] = id;
      db.prepare(
        `INSERT INTO users (id, username, display_name, bio, avatar_color, weekly_goal_min, password_hash, password_salt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, u.username, u.displayName, u.bio, u.color, u.goal, hash, salt, created);
    }
    for (const a of USERS) for (const b of USERS) {
      if (a !== b) db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(ids[a.username]!, ids[b.username]!, created);
    }

    // activity probability per user (ava is the consistent one, with a live streak)
    const activity: Record<string, number> = { ava: 1, noah: 0.75, mia: 0.6, leo: 0.45 };
    for (const u of USERS) {
      for (let back = 21; back >= 0; back--) {
        const p = activity[u.username]!;
        const forced = u.username === 'ava' && back <= 12; // guaranteed ongoing streak
        if (!forced && rand() > p) continue;
        const sessionsToday = rand() < 0.3 ? 2 : 1;
        for (let k = 0; k < sessionsToday; k++) {
          const date = ymdFromDayNum(todayN - back);
          const category = pick(CATEGORIES.filter((c) => c !== 'other' || rand() < 0.3));
          const hour = k === 0 ? 7 + Math.floor(rand() * 5) : 14 + Math.floor(rand() * 6);
          const start = new Date(`${date}T${String(hour).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00.000Z`);
          const focusMin = 25 + Math.floor(rand() * 11) * 12; // 25..145
          const focusMs = focusMin * 60_000 + Math.floor(rand() * 50_000);
          const end = new Date(start.getTime() + focusMs + Math.floor(rand() * 8) * 60_000);
          if (end > now) continue; // never create sessions in the future
          const intervalSec = pick([2, 5, 5, 5, 10]);
          const frameCount = Math.round(focusMs / 1000 / intervalSec);
          const tod = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
          const title = rand() < 0.5 ? `${tod} ${category[0]!.toUpperCase()}${category.slice(1)} Session` : pick(CATEGORY_TITLES[category]);
          const r = rand();
          const visibility: Visibility = r < 0.78 ? 'public' : r < 0.93 ? 'followers' : 'private';
          const id = crypto.randomUUID();
          const asset = assets[category];
          let videoFile = '';
          if (asset.video) {
            videoFile = `${id}.webm`;
            fs.copyFileSync(asset.video, path.join(mediaDir, videoFile));
          }
          const thumbFile = `${id}.jpg`;
          fs.copyFileSync(asset.thumb, path.join(mediaDir, thumbFile));
          db.prepare(
            `INSERT INTO sessions (id, user_id, title, description, category, visibility, started_at, ended_at, focus_ms, frame_count,
               interval_sec, video_duration_ms, local_date, video_file, thumb_file, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id, ids[u.username]!, title, rand() < 0.4 ? pick(['Locked in.', 'Phone face-down, timelapse running.', 'Coffee + headphones.', 'Hard problem today.']) : '',
            category, visibility, start.toISOString(), end.toISOString(), focusMs, frameCount, intervalSec,
            Math.round((frameCount / 30) * 1000), date, videoFile, thumbFile, end.toISOString(),
          );
          sessionIds.push({ id, userId: ids[u.username]!, visibility });
          sessionCount++;
        }
      }
    }

    // kudos + comments from the other (following) demo users on non-private sessions
    let kudos = 0;
    let comments = 0;
    for (const s of sessionIds) {
      if (s.visibility === 'private') continue;
      for (const other of USERS) {
        const oid = ids[other.username]!;
        if (oid === s.userId) continue;
        if (rand() < 0.55) {
          db.prepare('INSERT OR IGNORE INTO kudos (session_id, user_id, created_at) VALUES (?, ?, ?)').run(s.id, oid, nowIso);
          kudos++;
        }
        if (rand() < 0.15) {
          db.prepare('INSERT INTO comments (id, session_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(crypto.randomUUID(), s.id, oid, pick(COMMENTS), nowIso);
          comments++;
        }
      }
    }
    console.log(`Created ${USERS.length} users, ${sessionCount} sessions, ${kudos} kudos, ${comments} comments.`);
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  db.close();
  console.log(
    haveVideo
      ? 'Media: generated placeholder .webm timelapses + JPEG thumbnails with ffmpeg.'
      : 'Media: ffmpeg not found -> thumbnails only; sessions have videoUrl "" (UI should show the thumbnail).',
  );
  console.log(`Data dir: ${dataDir}\nLog in as ava / noah / mia / leo with password "password".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
