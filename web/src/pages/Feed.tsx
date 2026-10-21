import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardEntry } from '@shared/types';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ActivityCard } from '../components/ActivityCard';
import { SearchIcon } from '../components/icons';
import { LeaderboardStrip } from '../components/Leaderboard';
import { InfiniteSentinel, useInfiniteList } from '../components/useInfiniteList';

export function Feed() {
  const { user } = useAuth();
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const list = useInfiniteList((cursor) => api.feed(cursor), 'feed');

  useEffect(() => {
    let cancelled = false;
    api
      .leaderboard()
      .then((b) => !cancelled && setBoard(b))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page">
      <header className="app-header">
        <div className="logo">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <span>Latent</span>
        </div>
        <Link to="/search" className="icon-btn" aria-label="Find people">
          <SearchIcon />
        </Link>
      </header>

      <LeaderboardStrip entries={board} meId={user?.id} />

      {list.items.map((s) => (
        <ActivityCard key={s.id} session={s} />
      ))}

      {list.loading && list.items.length === 0 && (
        <>
          <div className="card skeleton-card" />
          <div className="card skeleton-card" />
        </>
      )}

      {!list.loading && !list.error && list.items.length === 0 && (
        <div className="empty">
          <div className="empty-emoji" aria-hidden="true">
            🌒
          </div>
          <h2>Nothing here yet</h2>
          <p className="muted">Record your first deep work session, or follow friends to fill your feed.</p>
          <div className="empty-actions">
            <Link to="/record" className="btn btn-primary">
              Record a session
            </Link>
            <Link to="/search" className="btn btn-ghost">
              Find friends
            </Link>
          </div>
        </div>
      )}

      {list.error && (
        <div className="empty">
          <p className="error-text">{list.error}</p>
          <button type="button" className="btn btn-ghost" onClick={() => void list.loadMore()}>
            Try again
          </button>
        </div>
      )}

      <InfiniteSentinel
        onVisible={() => void list.loadMore()}
        disabled={!list.hasMore || list.loading || !!list.error}
        watch={list.items.length}
      />
      {list.loading && list.items.length > 0 && <div className="spinner small-spinner" role="status" aria-label="Loading more" />}
    </main>
  );
}
