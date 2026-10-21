import { useCallback, useEffect, useRef, useState } from 'react';
import { WakeLockManager, type CaptureState } from '../../capture';
import { PauseIcon, PlayIcon, StopIcon } from '../../components/icons';
import { formatClock } from '../../lib/format';

const LONG_PRESS_MS = 600;
const REVEAL_MS = 4000;

export function FocusOverlay({
  state,
  onPause,
  onResume,
  onStop,
}: {
  state: CaptureState | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pressTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const stamp = useRef({ elapsedMs: 0, at: Date.now() });

  const status = state?.status ?? 'starting';
  const paused = status === 'paused';
  const errored = status === 'error';

  // Interpolate between engine updates so the clock ticks every second.
  if (state && (stamp.current.elapsedMs !== state.elapsedMs || paused)) {
    stamp.current = { elapsedMs: state.elapsedMs, at: Date.now() };
  }
  const elapsed =
    status === 'recording' ? stamp.current.elapsedMs + Math.max(0, now - stamp.current.at) : (state?.elapsedMs ?? 0);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Belt and braces alongside the engine's own wake lock.
  useEffect(() => {
    const wl = new WakeLockManager();
    void wl.acquire().catch(() => undefined);
    const onVis = () => {
      if (document.visibilityState === 'visible') void wl.acquire().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void wl.release().catch(() => undefined);
    };
  }, []);

  const reveal = useCallback(() => {
    setRevealed(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setRevealed(false), REVEAL_MS);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(pressTimer.current);
      window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const startPress = () => {
    window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(reveal, LONG_PRESS_MS);
  };
  const cancelPress = () => window.clearTimeout(pressTimer.current);

  // Nudge the clock a few pixels each minute to avoid OLED burn-in.
  const minute = Math.floor(elapsed / 60000);
  const shift = { transform: `translate(${((minute * 7) % 5) * 6 - 12}px, ${((minute * 3) % 5) * 6 - 12}px)` };

  const touchControls = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      fn();
      reveal();
    },
  });

  return (
    <div
      className="focus-overlay"
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Recording in progress. Press and hold to show controls."
    >
      <div className="focus-center" style={shift}>
        <div className="focus-clock num" aria-live="off">
          {formatClock(elapsed)}
        </div>
        <div className="focus-text">
          {errored ? (state?.error ?? 'Camera error. Stop to keep what was captured.') : paused ? 'Paused' : status === 'starting' ? 'Starting…' : "Phone down. You're recording."}
        </div>
        <div className="focus-frames num">
          {(state?.frameCount ?? 0).toLocaleString()} frames
        </div>
      </div>

      {state?.lastFrameUrl && <img className="focus-thumb" src={state.lastFrameUrl} alt="" />}

      {!revealed && !errored && <div className="focus-hint">Hold to show controls</div>}

      {(revealed || errored) && (
        <div className="focus-controls" onPointerDown={(e) => e.stopPropagation()}>
          {!errored && (
            <button type="button" className="focus-btn" {...touchControls(paused ? onResume : onPause)}>
              {paused ? <PlayIcon width={26} height={26} /> : <PauseIcon width={26} height={26} />}
              <span>{paused ? 'Resume' : 'Pause'}</span>
            </button>
          )}
          <button type="button" className="focus-btn stop" {...touchControls(onStop)}>
            <StopIcon width={26} height={26} />
            <span>Stop</span>
          </button>
        </div>
      )}
    </div>
  );
}
