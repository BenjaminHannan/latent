import { Link } from 'react-router-dom';
import type { WorkSession } from '@shared/types';
import { categoryMeta, formatDuration, timeAgo } from '../lib/format';
import { Avatar } from './Avatar';
import { CommentIcon } from './icons';
import { KudosButton } from './KudosButton';
import { TimelapseVideo } from './TimelapseVideo';

export function CategoryChip({ category }: { category: WorkSession['category'] }) {
  const m = categoryMeta[category] ?? categoryMeta.other;
  return (
    <span className="chip">
      <span aria-hidden="true">{m.emoji}</span> {m.label}
    </span>
  );
}

export function StatsRow({ s }: { s: Pick<WorkSession, 'focusMs' | 'frameCount' | 'intervalSec'> }) {
  return (
    <dl className="stats-row">
      <div>
        <dt>Focus time</dt>
        <dd className="num">{formatDuration(s.focusMs)}</dd>
      </div>
      <div>
        <dt>Frames</dt>
        <dd className="num">{s.frameCount.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Interval</dt>
        <dd className="num">{s.intervalSec}s</dd>
      </div>
    </dl>
  );
}

export function ActivityCard({ session }: { session: WorkSession }) {
  const s = session;
  return (
    <article className="card activity" data-testid="activity-card">
      <header className="card-head">
        <Avatar user={s.user} link />
        <div className="card-who">
          <Link to={`/u/${s.user.username}`} className="name">
            {s.user.displayName}
          </Link>
          <span className="muted small">
            {timeAgo(s.endedAt || s.createdAt)}
            {s.visibility !== 'public' && <> · {s.visibility === 'private' ? 'Only you' : 'Followers'}</>}
          </span>
        </div>
        <CategoryChip category={s.category} />
      </header>

      <Link to={`/s/${s.id}`} className="card-title">
        <h2>{s.title}</h2>
      </Link>

      <StatsRow s={s} />

      <div className="media-wrap">
        <TimelapseVideo videoUrl={s.videoUrl} thumbnailUrl={s.thumbnailUrl} title={s.title} />
      </div>

      <footer className="card-actions">
        <KudosButton sessionId={s.id} kudos={s.kudos} hasKudoed={s.hasKudoed} />
        <Link to={`/s/${s.id}#comments`} className="action-btn" aria-label={`${s.commentCount} comments`}>
          <CommentIcon />
          <span className="num">{s.commentCount}</span>
        </Link>
      </footer>
    </article>
  );
}

/** Compact row for profile lists. */
export function SessionRow({ session: s }: { session: WorkSession }) {
  const m = categoryMeta[s.category] ?? categoryMeta.other;
  return (
    <Link to={`/s/${s.id}`} className="row-card">
      <div className="row-thumb">
        {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" loading="lazy" /> : <span aria-hidden="true">{m.emoji}</span>}
      </div>
      <div className="row-body">
        <div className="row-title">{s.title}</div>
        <div className="muted small">
          {m.emoji} {m.label} · {timeAgo(s.endedAt || s.createdAt)}
        </div>
        <div className="row-stats num small">
          {formatDuration(s.focusMs)} · {s.frameCount.toLocaleString()} frames · 👍 {s.kudos}
        </div>
      </div>
    </Link>
  );
}
