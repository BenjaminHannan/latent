import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Stats, UserProfile } from '@shared/types';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { SessionRow } from '../components/ActivityCard';
import { Avatar } from '../components/Avatar';
import { CategoryBars, ProgressRing, WeeklyBars } from '../components/Charts';
import { FollowButton } from '../components/FollowButton';
import { PageHeader } from '../components/PageHeader';
import { InfiniteSentinel, useInfiniteList } from '../components/useInfiniteList';
import { formatHours } from '../lib/format';

export function YouRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={`/u/${user.username}`} replace />;
}

export function Profile() {
  const { username = '' } = useParams();
  const { user: me, logout, setUser } = useAuth();
  const nav = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [editing, setEditing] = useState(false);
  const list = useInfiniteList((cursor) => api.userSessions(username, cursor), `u:${username}`);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setStats(null);
    setError(null);
    api
      .getUser(username)
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        if (p.isMe) api.stats().then((s) => !cancelled && setStats(s)).catch(() => undefined);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load profile'));
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (error) {
    return (
      <main className="page">
        <PageHeader title="Profile" />
        <p className="error-text center-text">{error}</p>
      </main>
    );
  }
  if (!profile) {
    return (
      <main className="page">
        <PageHeader title="Profile" back={false} />
        <div className="spinner small-spinner" role="status" aria-label="Loading" />
      </main>
    );
  }

  const p = profile;
  const isMe = p.isMe || me?.username === p.username;

  return (
    <main className="page profile">
      <PageHeader
        title={`@${p.username}`}
        back={!isMe}
        right={
          isMe ? (
            <button
              type="button"
              className="icon-btn text-btn"
              onClick={() => {
                logout();
                nav('/login', { replace: true });
              }}
            >
              Log out
            </button>
          ) : undefined
        }
      />

      <section className="profile-head">
        <Avatar user={p} size={84} />
        <h2>{p.displayName}</h2>
        <p className="muted">@{p.username}</p>
        {p.bio && <p className="bio">{p.bio}</p>}
        <div className="profile-actions">
          {isMe ? (
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
              Edit profile
            </button>
          ) : (
            <FollowButton
              username={p.username}
              initial={p.isFollowing}
              onChange={(f) => setProfile((cur) => (cur ? { ...cur, isFollowing: f, followers: Math.max(0, cur.followers + (f === cur.isFollowing ? 0 : f ? 1 : -1)) } : cur))}
            />
          )}
        </div>
      </section>

      <dl className="counts">
        <div>
          <dd className="num">{p.sessionCount}</dd>
          <dt>Sessions</dt>
        </div>
        <div>
          <dd className="num">{formatHours(p.totalFocusMin)}</dd>
          <dt>Hours</dt>
        </div>
        <div>
          <dd className="num">{p.followers}</dd>
          <dt>Followers</dt>
        </div>
        <div>
          <dd className="num">{p.following}</dd>
          <dt>Following</dt>
        </div>
      </dl>

      {isMe && stats && (
        <>
          <div className="grid-2">
            <section className="card stat-card streak">
              <h3 className="section-label">Streak</h3>
              <div className="streak-main">
                <span className={`flame${stats.streakDays > 0 ? ' lit' : ''}`} aria-hidden="true">
                  🔥
                </span>
                <span className="num big">{stats.streakDays}</span>
                <span className="muted small">{stats.streakDays === 1 ? 'day' : 'days'}</span>
              </div>
              <p className="muted small">Longest: {stats.longestStreakDays} {stats.longestStreakDays === 1 ? 'day' : 'days'}</p>
            </section>
            <section className="card stat-card goal">
              <h3 className="section-label">Weekly goal</h3>
              <ProgressRing valueMin={stats.thisWeekMin} goalMin={stats.weeklyGoalMin} size={112} />
            </section>
          </div>

          <section className="card">
            <h3 className="section-label">Last 12 weeks · hours</h3>
            <WeeklyBars weeks={stats.weeks} />
          </section>

          <section className="card">
            <h3 className="section-label">By category</h3>
            <CategoryBars data={stats.byCategory} />
          </section>
        </>
      )}

      <h3 className="section-label list-label">Sessions</h3>
      <div className="row-list">
        {list.items.map((s) => (
          <SessionRow key={s.id} session={s} />
        ))}
      </div>
      {!list.loading && !list.error && list.items.length === 0 && (
        <p className="muted center-text">{isMe ? 'No sessions yet. Hit record to start your first.' : 'No sessions to show.'}</p>
      )}
      {list.error && <p className="error-text center-text">{list.error}</p>}
      <InfiniteSentinel onVisible={() => void list.loadMore()} disabled={!list.hasMore || list.loading || !!list.error} watch={list.items.length} />
      {list.loading && <div className="spinner small-spinner" role="status" aria-label="Loading sessions" />}

      {editing && (
        <EditProfile
          profile={p}
          goalMin={stats?.weeklyGoalMin ?? p.weeklyGoalMin}
          onClose={() => setEditing(false)}
          onSaved={(u) => {
            setProfile((cur) => (cur ? { ...cur, ...u } : cur));
            setUser(u);
            setStats((s) => (s ? { ...s, weeklyGoalMin: u.weeklyGoalMin } : s));
            setEditing(false);
          }}
        />
      )}
    </main>
  );
}

function EditProfile({
  profile,
  goalMin,
  onClose,
  onSaved,
}: {
  profile: UserProfile;
  goalMin: number;
  onClose: () => void;
  onSaved: (u: import('@shared/types').User) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [goalHours, setGoalHours] = useState(String(+(goalMin / 60).toFixed(1)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const hours = Number(goalHours);
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 100) {
      setError('Weekly goal should be between 0.5 and 100 hours.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await api.updateMe({
        displayName: displayName.trim() || profile.displayName,
        bio,
        weeklyGoalMin: Math.round(hours * 60),
      });
      onSaved(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet form" onSubmit={save} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit profile">
        <h2>Edit profile</h2>
        <label>
          <span>Display name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} />
        </label>
        <label>
          <span>Bio</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={160} />
        </label>
        <label>
          <span>Weekly goal (hours)</span>
          <input type="number" inputMode="decimal" step="0.5" min="0.5" max="100" value={goalHours} onChange={(e) => setGoalHours(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
