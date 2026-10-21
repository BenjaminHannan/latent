import { useState } from 'react';
import { api } from '../api/client';

export function FollowButton({
  username,
  initial,
  onChange,
  size = 'md',
}: {
  username: string;
  initial: boolean;
  onChange?: (following: boolean) => void;
  size?: 'sm' | 'md';
}) {
  const [following, setFollowing] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const prev = following;
    setFollowing(!prev);
    onChange?.(!prev);
    setBusy(true);
    try {
      const res = prev ? await api.unfollow(username) : await api.follow(username);
      setFollowing(res.following);
      if (res.following !== !prev) onChange?.(res.following);
    } catch {
      setFollowing(prev);
      onChange?.(prev);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`btn ${following ? 'btn-ghost' : 'btn-primary'}${size === 'sm' ? ' btn-sm' : ''}`}
      onClick={toggle}
      aria-pressed={following}
    >
      {following ? 'Following' : 'Follow'}
    </button>
  );
}
