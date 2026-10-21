import { useEffect, useRef, useState } from 'react';
import { loadFrames } from '../capture';

/** Flipbook fallback: plays stored JPEG frames when video export isn't available. */
export function FramePlayer({ sessionId, fps = 12 }: { sessionId: string; fps?: number }) {
  const [urls, setUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadFrames(sessionId)
      .then((blobs) => {
        if (cancelled) return;
        const u = blobs.map((b) => URL.createObjectURL(b));
        urlsRef.current = u;
        setUrls(u);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load frames'));
    return () => {
      cancelled = true;
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      urlsRef.current = [];
    };
  }, [sessionId]);

  useEffect(() => {
    if (!playing || urls.length < 2) return;
    const t = window.setInterval(() => setIdx((i) => (i + 1) % urls.length), 1000 / fps);
    return () => window.clearInterval(t);
  }, [playing, urls.length, fps]);

  if (error) return <p className="error-text">{error}</p>;
  if (urls.length === 0) return <div className="player-box skeleton" />;

  return (
    <div className="frame-player">
      <img className="media" src={urls[Math.min(idx, urls.length - 1)]} alt="Timelapse preview frame" />
      <div className="frame-controls">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={urls.length - 1}
          value={Math.min(idx, urls.length - 1)}
          onChange={(e) => {
            setPlaying(false);
            setIdx(Number(e.target.value));
          }}
          aria-label="Scrub frames"
        />
        <span className="num small muted">
          {Math.min(idx, urls.length - 1) + 1}/{urls.length}
        </span>
      </div>
    </div>
  );
}
