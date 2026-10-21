import { useState } from 'react';
import { api } from '../api/client';
import { ThumbIcon } from './icons';

export function KudosButton({
  sessionId,
  kudos,
  hasKudoed,
}: {
  sessionId: string;
  kudos: number;
  hasKudoed: boolean;
}) {
  const [state, setState] = useState({ kudos, hasKudoed });
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const prev = state;
    const next = { hasKudoed: !prev.hasKudoed, kudos: Math.max(0, prev.kudos + (prev.hasKudoed ? -1 : 1)) };
    setState(next); // optimistic
    setBusy(true);
    try {
      const res = prev.hasKudoed ? await api.removeKudos(sessionId) : await api.giveKudos(sessionId);
      setState({ kudos: res.kudos, hasKudoed: res.hasKudoed });
    } catch {
      setState(prev); // revert
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`action-btn kudos${state.hasKudoed ? ' active' : ''}`}
      aria-pressed={state.hasKudoed}
      aria-label={state.hasKudoed ? 'Remove kudos' : 'Give kudos'}
      onClick={toggle}
    >
      <ThumbIcon filled={state.hasKudoed} />
      <span className="num" data-testid="kudos-count">
        {state.kudos}
      </span>
    </button>
  );
}
