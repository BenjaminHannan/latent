import { useEffect, useState } from 'react';
import { CATEGORIES } from '@shared/types';
import { deleteFrames, estimateStorage, isCaptureSupported, listRecoverableSessions } from '../../capture';
import { FlipIcon } from '../../components/icons';
import { categoryMeta, formatBytes, timeAgo } from '../../lib/format';
import { INTERVAL_OPTIONS, type RecordSettings } from './types';
import { useCameraPreview } from './useCameraPreview';

type Recoverable = { id: string; frames: number; startedAt: string };

export function Setup({
  settings,
  onChange,
  onStart,
  onRecover,
  starting,
  error,
}: {
  settings: RecordSettings;
  onChange: (s: RecordSettings) => void;
  onStart: () => Promise<void>;
  onRecover: (r: Recoverable) => void;
  starting: boolean;
  error: string | null;
}) {
  const supported = isCaptureSupported();
  const preview = useCameraPreview(settings.facingMode, supported && !starting);
  const [recoverable, setRecoverable] = useState<Recoverable[]>([]);

  useEffect(() => {
    let cancelled = false;
    listRecoverableSessions()
      .then((r) => !cancelled && setRecoverable(r.filter((x) => x.frames > 0)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<RecordSettings>) => onChange({ ...settings, ...patch });
  const saverAllowed = settings.intervalSec >= 10;
  const est = estimateStorage(60, settings.intervalSec);

  async function start() {
    preview.stop(); // release the camera before the engine opens it
    await new Promise((r) => setTimeout(r, 150));
    await onStart();
  }

  async function discard(id: string) {
    if (!window.confirm('Discard this unsaved session? The frames will be deleted.')) return;
    try {
      await deleteFrames(id);
    } catch {
      /* ignore */
    }
    setRecoverable((r) => r.filter((x) => x.id !== id));
  }

  return (
    <main className="page record-setup">
      <header className="app-header">
        <h1 className="page-title">Record</h1>
      </header>

      {recoverable.map((r) => (
        <div className="banner" key={r.id} role="status">
          <div>
            <strong>Unsaved session found</strong>
            <div className="muted small">
              {r.frames.toLocaleString()} frames · started {timeAgo(r.startedAt)}
            </div>
          </div>
          <div className="btn-row tight">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void discard(r.id)}>
              Discard
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onRecover(r)}>
              Recover
            </button>
          </div>
        </div>
      ))}

      {!supported ? (
        <div className="notice">
          <h2>Camera capture isn't supported here</h2>
          <p className="muted">
            Latent needs a browser with camera access (getUserMedia) over HTTPS. Try Safari on iOS or Chrome on Android, or open the app from a secure address.
          </p>
        </div>
      ) : (
        <>
          <div className="preview">
            <video ref={preview.videoRef} muted playsInline autoPlay className={preview.ready ? 'ready' : ''} />
            {!preview.ready && !preview.error && <div className="preview-msg muted">Starting camera…</div>}
            {preview.error && (
              <div className="preview-msg">
                {preview.error === 'denied' ? (
                  <>
                    <strong>Camera permission denied</strong>
                    <span className="muted small">
                      Allow camera access for this site in your browser settings, then reload. Latent only keeps small still frames on your device until you save.
                    </span>
                  </>
                ) : preview.error === 'insecure' ? (
                  <>
                    <strong>Secure connection required</strong>
                    <span className="muted small">Open Latent over HTTPS (or localhost) to use the camera.</span>
                  </>
                ) : (
                  <>
                    <strong>No camera available</strong>
                    <span className="muted small">We couldn't find a camera we can use on this device.</span>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              className="flip-btn"
              onClick={() => set({ facingMode: settings.facingMode === 'environment' ? 'user' : 'environment' })}
              aria-label="Flip camera"
            >
              <FlipIcon />
            </button>
          </div>

          <section className="field-group">
            <h3 className="section-label">Capture a frame every</h3>
            <div className="segmented" role="radiogroup" aria-label="Interval">
              {INTERVAL_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={settings.intervalSec === n}
                  className={settings.intervalSec === n ? 'on' : ''}
                  onClick={() => set({ intervalSec: n, batterySaver: n >= 10 ? settings.batterySaver : false })}
                >
                  {n}s
                </button>
              ))}
            </div>
          </section>

          <section className="field-group">
            <h3 className="section-label">What are you working on?</h3>
            <div className="chips" role="radiogroup" aria-label="Category">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={settings.category === c}
                  className={`chip chip-btn${settings.category === c ? ' on' : ''}`}
                  onClick={() => set({ category: c })}
                >
                  <span aria-hidden="true">{categoryMeta[c].emoji}</span> {categoryMeta[c].label}
                </button>
              ))}
            </div>
          </section>

          <label className={`toggle${saverAllowed ? '' : ' disabled'}`}>
            <span>
              <strong>Battery saver</strong>
              <span className="muted small">
                {saverAllowed ? 'Turns the camera off between frames' : 'Available at 10s intervals or longer'}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={saverAllowed && settings.batterySaver}
              disabled={!saverAllowed}
              onChange={(e) => set({ batterySaver: e.target.checked })}
            />
          </label>

          <p className="estimate num" data-testid="estimate">
            1h ≈ {est.frames.toLocaleString()} frames · {formatBytes(est.bytes)}{' '}
            <span className="muted">— vs {formatBytes(est.videoBytesEquivalent)} of video</span>
          </p>

          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}

          <button type="button" className="btn btn-primary btn-xl btn-block" onClick={() => void start()} disabled={starting}>
            {starting ? 'Starting…' : 'Start'}
          </button>
          <p className="muted small center-text">Prop your phone up facing your desk. The screen goes dark and quiet.</p>
        </>
      )}
    </main>
  );
}
