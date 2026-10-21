import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { TabBar } from './TabBar';

const LayoutCtx = createContext<{ setTabBarHidden: (h: boolean) => void }>({ setTabBarHidden: () => undefined });

/** Pages call this to hide the tab bar (e.g. during recording). */
export function useHideTabBar(hidden: boolean) {
  const { setTabBarHidden } = useContext(LayoutCtx);
  useEffect(() => {
    setTabBarHidden(hidden);
    return () => setTabBarHidden(false);
  }, [hidden, setTabBarHidden]);
}

export function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  );
}

/** Auth guard + shell with tab bar. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  const [hidden, setHidden] = useState(false);
  const ctx = useMemo(() => ({ setTabBarHidden: setHidden }), []);

  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return (
    <LayoutCtx.Provider value={ctx}>
      <div className={`shell${hidden ? ' no-tabs' : ''}`}>
        <Outlet />
      </div>
      {!hidden && <TabBar />}
    </LayoutCtx.Provider>
  );
}
