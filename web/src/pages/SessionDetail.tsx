import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CATEGORIES, type Category, type Comment, type Visibility, type WorkSession } from '@shared/types';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { CategoryChip } from '../components/ActivityCard';
import { Avatar } from '../components/Avatar';
import { MoreIcon } from '../components/icons';
import { KudosButton } from '../components/KudosButton';
import { PageHeader } from '../components/PageHeader';
import { categoryMeta, formatDuration, formatTimeRange, formatVideoLength, timeAgo } from '../lib/format';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

export function SessionDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [session, setSession] = useState<WorkSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setError(null);
    api
      .getSession(id)
      .then((s) => !cancelled && setSession(s))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load session'));
    api
      .comments(id)
      .then((c) => !cancelled && setComments(c))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Scroll to comments when linked with #comments
  useEffect(() => {
    if (session && window.location.hash === '#comments') {
      document.getElementById('comments')?.scrollIntoView();
    }
  }, [session]);

  async function postComment(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const c = await api.addComment(id, body);
      setComments((prev) => [...prev, c]);
      setSession((s) => (s ? { ...s, commentCount: s.commentCount + 1 } : s));
      setDraft('');
    } catch (err) {
      setPostError(err instanceof Error ? err.message : 'Could not post comment');
    } finally {
      setPosting(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this session? This cannot be undone.')) return;
    try {
      await api.deleteSession(id);
      nav('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    }
  }

  if (error && !session) {
    return (
      <main className="page">
        <PageHeader title="Session" />
        <div className="empty">
          <p className="error-text">{error}</p>
          <Link to="/" className="btn btn-ghost">
            Back to feed
          </Link>
        </div>
      </main>
    );
  }
  if (!session) {
    return (
      <main className="page">
        <PageHeader title="Session" />
        <div className="player-box skeleton" />
      </main>
    );
  }

  const s = session;
  const isOwner = !!user && s.user.id === user.id;

  return (
    <main className="page detail">
      <PageHeader
        title="Session"
        right={
          isOwner ? (
            <div className="menu-wrap">
              <button type="button" className="icon-btn" aria-label="Session options" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                <MoreIcon />
              </button>
              {menu && (
                <div className="menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setEditing(true);
                    }}
                  >
                    Edit details
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMenu(false);
                      void remove();
                    }}
                  >
                    Delete session
                  </button>
                </div>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="media-wrap detail-media">
        {s.videoUrl ? (
          <video
            className="media detail-video"
            src={s.videoUrl}
            poster={s.thumbnailUrl || undefined}
            controls
            playsInline
            loop
            preload="metadata"
          />
        ) : (
          <img className="media" src={s.thumbnailUrl} alt={s.title} />
        )}
      </div>

      <section className="detail-body">
        <div className="detail-who">
          <Avatar user={s.user} link />
          <div className="card-who">
            <Link to={`/u/${s.user.username}`} className="name">
              {s.user.displayName}
            </Link>
            <span className="muted small">{timeAgo(s.endedAt)}</span>
          </div>
          <CategoryChip category={s.category} />
        </div>

        {editing ? (
          <EditForm
            session={s}
            onCancel={() => setEditing(false)}
            onSaved={(u) => {
              setSession(u);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <h2 className="detail-title">{s.title}</h2>
            {s.description && <p className="detail-desc">{s.description}</p>}
          </>
        )}
        {error && <p className="error-text">{error}</p>}

        <dl className="stats-grid">
          <Stat label="Focus time" value={formatDuration(s.focusMs)} />
          <Stat label="Frames" value={s.frameCount.toLocaleString()} />
          <Stat label="Interval" value={`${s.intervalSec}s`} />
          <Stat label="Timelapse length" value={formatVideoLength(s.videoDurationMs)} />
          <div className="stat wide">
            <dt>Started – Ended</dt>
            <dd className="num">{formatTimeRange(s.startedAt, s.endedAt)}</dd>
          </div>
        </dl>

        <div className="card-actions detail-actions">
          <KudosButton sessionId={s.id} kudos={s.kudos} hasKudoed={s.hasKudoed} />
          <span className="muted small">
            {s.visibility === 'public' ? 'Public' : s.visibility === 'followers' ? 'Followers only' : 'Only you'}
          </span>
        </div>
      </section>

      <section className="comments" id="comments">
        <h3 className="section-label">Comments · {comments.length}</h3>
        {comments.length === 0 && <p className="muted small">No comments yet. Say something encouraging.</p>}
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <Avatar user={c.user} size={32} link />
              <div>
                <div>
                  <Link to={`/u/${c.user.username}`} className="name">
                    {c.user.displayName}
                  </Link>{' '}
                  <span className="muted tiny">{timeAgo(c.createdAt)}</span>
                </div>
                <p>{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <form className="composer" onSubmit={postComment}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment"
            maxLength={500}
            aria-label="Add a comment"
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={!draft.trim() || posting}>
            Post
          </button>
        </form>
        {postError && <p className="error-text">{postError}</p>}
      </section>
    </main>
  );
}

function EditForm({
  session,
  onCancel,
  onSaved,
}: {
  session: WorkSession;
  onCancel: () => void;
  onSaved: (s: WorkSession) => void;
}) {
  const [title, setTitle] = useState(session.title);
  const [description, setDescription] = useState(session.description);
  const [visibility, setVisibility] = useState<Visibility>(session.visibility);
  const [category, setCategory] = useState<Category>(session.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateSession(session.id, { title: title.trim() || session.title, description, visibility, category });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <label>
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <label>
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
      </label>
      <label>
        <span>Category</span>
        <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryMeta[c].emoji} {categoryMeta[c].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Visibility</span>
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
          <option value="public">Public</option>
          <option value="followers">Followers</option>
          <option value="private">Only me</option>
        </select>
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}
