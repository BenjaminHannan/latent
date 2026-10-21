import { useCallback, useEffect, useRef, useState } from 'react';

export type PreviewError = 'denied' | 'unavailable' | 'insecure' | null;

/**
 * Standalone getUserMedia preview for the setup screen. It is fully stopped
 * (stop()) before the capture engine acquires the camera itself.
 */
export function useCameraPreview(facingMode: 'user' | 'environment', enabled: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<PreviewError>(null);
  const [ready, setReady] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(window.isSecureContext === false ? 'insecure' : 'unavailable');
      return;
    }
    let cancelled = false;
    setError(null);
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          void v.play().catch(() => undefined);
          setReady(true);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : '';
        setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [facingMode, enabled, stop]);

  return { videoRef, error, ready, stop };
}
