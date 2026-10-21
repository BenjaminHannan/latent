# Latent — spec

Latent is "Strava for deep work". You prop your phone up, hit record, and it films a
**timelapse of your work session**. Because the phone is busy recording, you can't
doom-scroll — that's the focus mechanic. Unlike the stock camera timelapse, Latent
**doesn't drain battery or fill storage**: it never records full video. It grabs one
small JPEG frame every N seconds from the camera stream, lets the screen dim to a
black "focus mode" overlay, and only assembles a short video at the end.

Sessions are then logged and shared like Strava activities: a feed of friends'
sessions with the timelapse, duration, category, kudos and comments, plus
personal stats (weekly hours, streaks, totals).

## Architecture

```
shared/types.ts      API contract (types only) — imported by web and server
server/              Node 22 + TypeScript + Express + node:sqlite REST API, port 8787
web/                 Vite + React 18 + TypeScript PWA (mobile-first), dev port 5173,
                     proxies /api and /media to the server
```

Root `package.json` uses npm workspaces (`web`, `server`) with scripts:
`dev` (runs both concurrently), `build`, `test`, `typecheck`.

## Capture engine (web/src/capture/) — the core trick

- `getUserMedia` with the rear camera (`facingMode: 'environment'`), low-ish
  resolution (720p max), toggle to front camera.
- Every `intervalSec` (default 5s; options 1/2/5/10/30) draw the current video
  frame onto an offscreen canvas → `canvas.toBlob('image/jpeg', 0.7)` → persist to
  IndexedDB immediately (frames survive a crash/reload; session can be recovered).
- Optionally **suspend the camera track between captures** when interval ≥ 10s
  (re-acquire ~1.5s before the next capture) to save battery.
- Screen Wake Lock API to keep the device awake; a black "focus overlay" with a dim
  clock + elapsed time so the OLED screen draws almost nothing. Tap-and-hold to
  reveal controls.
- Pause / resume / stop. Elapsed time excludes paused time.
- On stop: assemble the frames into a video at 30fps using canvas +
  `MediaRecorder` (webm/mp4, whichever is supported) — fall back to an animated
  frame player if MediaRecorder isn't available. Also produce a thumbnail JPEG.
- Storage estimate shown in UI: frames × avg size (e.g. "2h at 5s ≈ 1,440 frames ≈ 70 MB
  vs ~12 GB of 1080p video").

Public API (see `web/src/capture/index.ts`):

```ts
export interface CaptureOptions { intervalSec: number; facingMode: 'user' | 'environment'; resolution: 480 | 720; suspendBetweenFrames: boolean }
export interface CaptureState { status: 'idle'|'starting'|'recording'|'paused'|'stopping'|'error'; frameCount: number; elapsedMs: number; lastFrameUrl?: string; error?: string; bytesStored: number }
export class CaptureSession {
  constructor(opts: CaptureOptions)
  readonly id: string
  attachPreview(video: HTMLVideoElement): void   // live preview (optional)
  start(): Promise<void>
  pause(): void
  resume(): void
  stop(): Promise<{ frames: number; durationMs: number; startedAt: string; endedAt: string }>
  subscribe(fn: (s: CaptureState) => void): () => void
  discard(): Promise<void>
}
export function renderTimelapse(sessionId: string, opts?: { fps?: number; onProgress?: (p: number) => void; overlay?: { label?: string } }): Promise<{ video: Blob; mimeType: string; thumbnail: Blob; videoDurationMs: number }>
export function listRecoverableSessions(): Promise<{ id: string; frames: number; startedAt: string }[]>
export function deleteFrames(sessionId: string): Promise<void>
export function estimateStorage(durationMin: number, intervalSec: number): { frames: number; bytes: number; videoBytesEquivalent: number }
export class WakeLockManager { acquire(): Promise<boolean>; release(): Promise<void> }
```

## Server API (all JSON, under /api; auth via `Authorization: Bearer <token>`)

Types live in `shared/types.ts`. Endpoints:

| Method | Path | Body / notes | Returns |
|---|---|---|---|
| POST | /api/auth/signup | `{username, displayName, password}` | `AuthResponse` |
| POST | /api/auth/login | `{username, password}` | `AuthResponse` |
| GET | /api/me | | `User` |
| PATCH | /api/me | `{displayName?, bio?, weeklyGoalMin?}` | `User` |
| GET | /api/users/:username | | `UserProfile` |
| POST | /api/users/:username/follow · DELETE same | | `{following: boolean}` |
| GET | /api/users/search?q= | | `User[]` |
| POST | /api/sessions | multipart: `meta` (JSON `CreateSessionInput`), `video` file, `thumbnail` file | `WorkSession` |
| GET | /api/sessions/:id | | `WorkSession` |
| PATCH | /api/sessions/:id | `{title?, description?, category?, visibility?}` | `WorkSession` |
| DELETE | /api/sessions/:id | owner only | 204 |
| GET | /api/feed?cursor= | sessions by me + people I follow, newest first, 20/page | `Page<WorkSession>` |
| GET | /api/users/:username/sessions?cursor= | | `Page<WorkSession>` |
| POST/DELETE | /api/sessions/:id/kudos | | `{kudos: number, hasKudoed: boolean}` |
| GET | /api/sessions/:id/comments | | `Comment[]` |
| POST | /api/sessions/:id/comments | `{body}` | `Comment` |
| GET | /api/stats/me | | `Stats` |
| GET | /api/leaderboard?period=week | following + me, by focused minutes | `LeaderboardEntry[]` |

Media is served at `/media/<file>`. Passwords hashed with `crypto.scrypt`. Tokens are random
32-byte hex stored in a `tokens` table. Visibility `private` sessions only visible to owner;
`followers` to followers; `public` to anyone authenticated.

Streak = consecutive days (user's local date as provided by `localDate` on the session)
with ≥1 session ending today or yesterday.

## Web app screens (mobile-first, dark UI, accent #FF5A1F "latent orange")

Bottom tab bar: **Feed · Record (big center button) · You**.

1. **Auth** — sign up / log in.
2. **Feed** — cards like Strava activities: avatar, name, time ago, title, category
   chip, stats row (Focus time · Frames · Interval), autoplaying muted looping
   timelapse (thumbnail poster), kudos button + count, comment count. Infinite scroll.
   Leaderboard strip at the top ("This week").
3. **Record** — setup: camera preview, interval picker, category picker (Study, Code,
   Write, Design, Music, Art, Other), storage/battery estimate. Start → full-screen
   black focus overlay with dim elapsed clock and frame counter; long-press to
   reveal pause/stop. After stop: render progress → **Save screen** with preview,
   title (auto "Morning Study Session" style from time of day + category),
   description, visibility, Save / Discard. Recover-unsaved-session banner.
4. **Session detail** — video player, stats, kudos list, comments thread.
5. **You / Profile** — header with counts (sessions, hours, followers, following),
   streak flame, weekly goal progress ring, 12-week bar chart of hours (plain SVG),
   category breakdown, list of own sessions; edit profile; follow button on others'
   profiles; user search.

Router: `react-router-dom`. Data fetching via a small typed client `web/src/api/client.ts`.
PWA: `manifest.webmanifest` + simple service worker for app-shell caching.
