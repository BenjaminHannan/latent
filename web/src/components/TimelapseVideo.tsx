import { useEffect, useRef } from 'react';

/** Autoplays (muted, looping) only while >= 50% visible. Falls back to the thumbnail if there is no video. */
export function TimelapseVideo({
  videoUrl,
  thumbnailUrl,
  title,
}: {
  videoUrl: string;
  thumbnailUrl: string;
  title: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.5) {
            const p = v.play();
            if (p && typeof p.catch === 'function') p.catch(() => undefined);
          } else {
            v.pause();
          }
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [videoUrl]);

  if (!videoUrl) {
    return thumbnailUrl ? (
      <img className="media" src={thumbnailUrl} alt={title} loading="lazy" />
    ) : (
      <div className="media media-empty" />
    );
  }
  return (
    <video
      ref={ref}
      className="media"
      src={videoUrl}
      poster={thumbnailUrl || undefined}
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      aria-label={title}
    />
  );
}
