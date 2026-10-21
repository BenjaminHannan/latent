import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackIcon } from './icons';

export function PageHeader({ title, back = true, right }: { title: ReactNode; back?: boolean; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="page-header">
      {back ? (
        <button type="button" className="icon-btn" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} aria-label="Back">
          <BackIcon />
        </button>
      ) : (
        <span className="icon-btn placeholder" />
      )}
      <h1>{title}</h1>
      <div className="header-right">{right}</div>
    </header>
  );
}
