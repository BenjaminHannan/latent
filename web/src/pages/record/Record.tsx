import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CaptureSession,
  RenderUnsupportedError,
  deleteFrames,
  getSessionMeta,
  renderTimelapse,
  type CaptureState,
} from '../../capture';
import { useHideTabBar } from '../../components/Layout';
import { safeGet, safeSet } from '../../lib/storage';
import { FocusOverlay } from './FocusOverlay';
import { RenderFailedView, RenderingView } from './RenderStep';
import { SaveStep } from './SaveStep';
import { Setup } from './Setup';
import type { RecordSettings, Rendered, SessionInfo } from './types';

const SETTINGS_KEY = 'latent.record.settings';
const DEFAULTS: RecordSettings = { intervalSec: 5, category: 'study', facingMode: 'environment', batterySaver: false };

function loadSettings(): RecordSettings {
  try {
    const raw = safeGet(SETTINGS_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<RecordSettings>) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

type Phase =
  | { kind: 'setup' }
  | { kind: 'recording' }
  | { kind: 'rendering'; info: SessionInfo }
  | { kind: 'failed'; info: SessionInfo; unsupported: boolean; message?: string }
  | { kind: 'save'; info: SessionInfo; rendered: Rendered };

function friendlyStartError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || /denied|not ?allowed|permission/i.test(msg)) {
    return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  }
  if (name === 'NotFoundError' || /not ?found|no camera/i.test(msg)) return 'No camera was found on this device.';
  return msg || 'Could not start recording.';
}

export function Record() {
  const nav = useNavigate();
  const [settings, setSettings] = useState<RecordSettings>(loadSettings);
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [cap, setCap] = useState<CaptureState | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const sessionRef = useRef<CaptureSession | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useHideTabBar(phase.kind !== 'setup');

  const updateSettings = useCallback((s: RecordSettings) => {
    setSettings(s);
    safeSet(SETTINGS_KEY, JSON.stringify(s));
  }, []);

  // Warn before leaving while there is unsaved work.
  const dirty = phase.kind !== 'setup';
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // If the page unmounts mid-recording, end the capture (frames stay recoverable).
  useEffect(
    () => () => {
      unsubRef.current?.();
      if (phaseRef.current.kind === 'recording') void sessionRef.current?.stop().catch(() => undefined);
    },
    [],
  );

  async function start() {
    setStartError(null);
    setStarting(true);
    const s = new CaptureSession({
      intervalSec: settings.intervalSec,
      facingMode: settings.facingMode,
      resolution: 720,
      suspendBetweenFrames: settings.batterySaver && settings.intervalSec >= 10,
    });
    sessionRef.current = s;
    unsubRef.current = s.subscribe(setCap);
    try {
      await s.start();
      setPhase({ kind: 'recording' });
    } catch (e) {
      unsubRef.current?.();
      unsubRef.current = null;
      setCap(null);
      void s.discard().catch(() => undefined);
      sessionRef.current = null;
      setStartError(friendlyStartError(e));
    } finally {
      setStarting(false);
    }
  }

  async function runRender(info: SessionInfo) {
    setProgress(0);
    setPhase({ kind: 'rendering', info });
    try {
      const rendered = await renderTimelapse(info.sessionId, { fps: 30, onProgress: setProgress });
      setPhase({ kind: 'save', info, rendered });
    } catch (e) {
      if (e instanceof RenderUnsupportedError) setPhase({ kind: 'failed', info, unsupported: true });
      else setPhase({ kind: 'failed', info, unsupported: false, message: e instanceof Error ? e.message : undefined });
    }
  }

  async function stop() {
    const s = sessionRef.current;
    if (!s) return;
    unsubRef.current?.();
    unsubRef.current = null;
    try {
      const r = await s.stop();
      const info: SessionInfo = {
        sessionId: s.id,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        focusMs: r.durationMs,
        frameCount: r.frames,
        intervalSec: settings.intervalSec,
        category: settings.category,
      };
      if (r.frames === 0) {
        await deleteFrames(s.id).catch(() => undefined);
        reset('No frames were captured, so there is nothing to save.');
        return;
      }
      void runRender(info);
    } catch (e) {
      reset(e instanceof Error ? e.message : 'Could not stop the session.');
    }
  }

  function reset(error?: string) {
    sessionRef.current = null;
    setCap(null);
    setStartError(error ?? null);
    setPhase({ kind: 'setup' });
  }

  async function recover(r: { id: string; frames: number; startedAt: string }) {
    // Prefer the engine's stored metadata (interval, focus time); fall back to the selected interval.
    let intervalSec = settings.intervalSec;
    let focusMs = r.frames * intervalSec * 1000;
    let endedAt: string | undefined;
    try {
      const meta = await getSessionMeta(r.id);
      if (meta) {
        intervalSec = meta.intervalSec || intervalSec;
        focusMs = meta.focusMs ?? r.frames * intervalSec * 1000;
        endedAt = meta.endedAt;
      }
    } catch {
      /* use fallbacks */
    }
    const info: SessionInfo = {
      sessionId: r.id,
      startedAt: r.startedAt,
      endedAt: endedAt ?? new Date(new Date(r.startedAt).getTime() + focusMs).toISOString(),
      focusMs,
      frameCount: r.frames,
      intervalSec,
      category: settings.category,
      recovered: true,
    };
    void runRender(info);
  }

  async function discardSession(info: SessionInfo) {
    try {
      await deleteFrames(info.sessionId);
    } catch {
      /* ignore */
    }
    reset();
  }

  switch (phase.kind) {
    case 'setup':
      return (
        <Setup
          settings={settings}
          onChange={updateSettings}
          onStart={start}
          onRecover={(r) => void recover(r)}
          starting={starting}
          error={startError}
        />
      );
    case 'recording':
      return (
        <FocusOverlay
          state={cap}
          onPause={() => sessionRef.current?.pause()}
          onResume={() => sessionRef.current?.resume()}
          onStop={() => void stop()}
        />
      );
    case 'rendering':
      return <RenderingView info={phase.info} progress={progress} />;
    case 'failed':
      return (
        <RenderFailedView
          info={phase.info}
          unsupported={phase.unsupported}
          message={phase.message}
          onRetry={() => void runRender(phase.info)}
          onKeep={() => reset()}
          onDiscard={() => {
            if (window.confirm('Discard this session? The frames will be deleted.')) void discardSession(phase.info);
          }}
        />
      );
    case 'save':
      return (
        <SaveStep
          info={phase.info}
          rendered={phase.rendered}
          onSaved={(s) => nav(`/s/${s.id}`, { replace: true })}
          onDiscard={() => void discardSession(phase.info)}
        />
      );
  }
}
