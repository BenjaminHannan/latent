import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AperturePlus, HomeIcon, UserIcon } from './icons';

export function TabBar() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const youActive = pathname === '/you' || (!!user && pathname === `/u/${user.username}`);
  return (
    <nav className="tabbar" aria-label="Main">
      <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
        <HomeIcon />
        <span>Feed</span>
      </NavLink>
      <NavLink to="/record" className={({ isActive }) => `tab tab-record${isActive ? ' active' : ''}`} aria-label="Record">
        <span className="record-btn">
          <AperturePlus />
        </span>
      </NavLink>
      <NavLink to="/you" className={`tab${youActive ? ' active' : ''}`}>
        <UserIcon />
        <span>You</span>
      </NavLink>
    </nav>
  );
}
