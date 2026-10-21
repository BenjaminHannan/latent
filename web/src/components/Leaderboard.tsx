import { Link } from 'react-router-dom';
import type { LeaderboardEntry } from '@shared/types';
import { formatHours } from '../lib/format';
import { Avatar } from './Avatar';

export function LeaderboardStrip({ entries, meId }: { entries: LeaderboardEntry[]; meId?: string }) {
  if (entries.length === 0) return null;
  return (
    <section className="leaderboard" aria-label="This week leaderboard">
      <h3 className="section-label">This week</h3>
      <ol className="lb-strip">
        {entries.map((e) => (
          <li key={e.user.id}>
            <Link to={`/u/${e.user.username}`} className={`lb-item${e.user.id === meId ? ' me' : ''}`}>
              <span className="lb-avatar">
                <Avatar user={e.user} size={48} />
                <span className={`lb-rank r${e.rank}`}>{e.rank}</span>
              </span>
              <span className="lb-name">{e.user.id === meId ? 'You' : e.user.displayName.split(' ')[0]}</span>
              <span className="lb-hours num">{formatHours(e.focusMin)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
