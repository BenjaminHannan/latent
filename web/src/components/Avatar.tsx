import { Link } from 'react-router-dom';
import type { User } from '@shared/types';
import { initials } from '../lib/format';

type Who = Pick<User, 'displayName' | 'avatarColor'> & Partial<Pick<User, 'username'>>;

export function Avatar({ user, size = 40, link = false }: { user: Who; size?: number; link?: boolean }) {
  const el = (
    <span
      className="avatar"
      style={{ width: size, height: size, background: user.avatarColor, fontSize: Math.round(size * 0.38) }}
      aria-hidden={link ? undefined : true}
      title={user.displayName}
    >
      {initials(user.displayName)}
    </span>
  );
  if (link && user.username) {
    return (
      <Link to={`/u/${user.username}`} aria-label={`${user.displayName}'s profile`} className="avatar-link">
        {el}
      </Link>
    );
  }
  return el;
}
