import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { User } from '@shared/types';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from '../components/Avatar';
import { FollowButton } from '../components/FollowButton';
import { PageHeader } from '../components/PageHeader';

function UserRow({ user, meId }: { user: User & { isFollowing?: boolean }; meId: string }) {
  const [following, setFollowing] = useState<boolean | null>(
    typeof user.isFollowing === 'boolean' ? user.isFollowing : null,
  );
  const isMe = user.id === meId;

  // /api/users/search returns plain Users, so look up follow state lazily.
  useEffect(() => {
    if (isMe || following !== null) return;
    let cancelled = false;
    api
      .getUser(user.username)
      .then((p) => !cancelled && setFollowing(p.isFollowing))
      .catch(() => !cancelled && setFollowing(false));
    return () => {
      cancelled = true;
    };
  }, [isMe, following, user.username]);

  return (
    <li className="user-row">
      <Avatar user={user} size={44} link />
      <Link to={`/u/${user.username}`} className="user-row-body">
        <span className="name">{user.displayName}</span>
        <span className="muted small">@{user.username}</span>
      </Link>
      {!isMe && following !== null && <FollowButton username={user.username} initial={following} size="sm" />}
    </li>
  );
}

export function Search() {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [results, setResults] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const term = text.trim();
    if (!term) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      api
        .searchUsers(term)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setError(null);
        })
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Search failed'))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [text]);

  return (
    <main className="page">
      <PageHeader title="Find people" />
      <div className="search-box">
        <input
          type="search"
          autoFocus
          placeholder="Search by name or username"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Search users"
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      {loading && !results && <div className="spinner small-spinner" role="status" aria-label="Searching" />}
      {results && results.length === 0 && !loading && <p className="muted center-text">No one found for “{text.trim()}”.</p>}
      {!text.trim() && <p className="muted center-text">Search for friends to follow and see their sessions in your feed.</p>}
      {results && results.length > 0 && (
        <ul className="user-list">
          {results.map((u) => (
            <UserRow key={u.id} user={u} meId={user?.id ?? ''} />
          ))}
        </ul>
      )}
    </main>
  );
}
