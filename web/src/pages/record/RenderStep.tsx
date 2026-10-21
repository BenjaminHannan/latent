import { FramePlayer } from '../../components/FramePlayer';
import { formatDuration } from '../../lib/format';
import type { SessionInfo } from './types';

export function RenderingView({ info, progress }: { info: SessionInfo; progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <main className="page center-page">
      <div className="render-box">
        <div className="render-ring spinner" aria-hidden="true" />
        <h2>Building your timelapse</h2>
        <p className="muted">
          {info.frameCount.toLocaleString()} frames · {formatDuration(info.focusMs)} of focus
        </p>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <p className="num muted small">{pct}%</p>
        <p className="muted small">
          Rendering runs in real time. Keep this screen open and in the foreground until it finishes. Your frames are safe on this device.
        </p>
      </div>
    </main>
  );
}

export function RenderFailedView({
  info,
  unsupported,
  message,
  onRetry,
  onKeep,
  onDiscard,
}: {
  info: SessionInfo;
  unsupported: boolean;
  message?: string;
  onRetry: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <main className="page">
      <header className="app-header">
        <h1 className="page-title">{unsupported ? 'Video export unavailable' : 'Render failed'}</h1>
      </header>
      <div className="notice">
        {unsupported ? (
          <p>
            This browser can't export video, so we can't upload this session yet. Your {info.frameCount.toLocaleString()} frames are safe on this device. Try again in Chrome (Android/desktop) or Safari (iOS 14.5+) and you'll see a Recover banner on the Record screen.
          </p>
        ) : (
          <p>
            {message || 'Something went wrong while building the video.'} Your frames are still on this device, so you can retry or recover them later.
          </p>
        )}
      </div>
      <FramePlayer sessionId={info.sessionId} />
      <div className="btn-row stack">
        {!unsupported && (
          <button type="button" className="btn btn-primary btn-block" onClick={onRetry}>
            Try again
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-block" onClick={onKeep}>
          Keep frames for later
        </button>
        <button type="button" className="btn btn-danger btn-block" onClick={onDiscard}>
          Discard session
        </button>
      </div>
    </main>
  );
}
