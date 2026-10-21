import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, type Category, type Visibility, type WorkSession } from '@shared/types';
import { api } from '../../api/client';
import { deleteFrames, markSessionSaved } from '../../capture';
import { categoryMeta, formatDuration, formatVideoLength, localDateString, titleForSession } from '../../lib/format';
import type { Rendered, SessionInfo } from './types';

export function SaveStep({
  info,
  rendered,
  onSaved,
  onDiscard,
}: {
  info: SessionInfo;
  rendered: Rendered;
  onSaved: (s: WorkSession) => void;
  onDiscard: () => void;
}) {
  const videoUrl = useMemo(() => URL.createObjectURL(rendered.video), [rendered.video]);
  useEffect(() => () => URL.revokeObjectURL(videoUrl), [videoUrl]);
  const posterUrl = useMemo(() => URL.createObjectURL(rendered.thumbnail), [rendered.thumbnail]);
  useEffect(() => () => URL.revokeObjectURL(posterUrl), [posterUrl]);

  const startedDate = useMemo(() => new Date(info.startedAt), [info.startedAt]);
  const [category, setCategory] = useState<Category>(info.category);
  const [title, setTitle] = useState(() => titleForSession(startedDate, info.category));
  const [titleEdited, setTitleEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickCategory(c: Category) {
    setCategory(c);
    if (!titleEdited) setTitle(titleForSession(startedDate, c));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setProgress(0);
    try {
      const session = await api.uploadSession(
        {
          title: title.trim() || titleForSession(startedDate, category),
          description: description.trim() || undefined,
          category,
          visibility,
          startedAt: info.startedAt,
          endedAt: info.endedAt,
          focusMs: Math.round(info.focusMs),
          frameCount: info.frameCount,
          intervalSec: info.intervalSec,
          videoDurationMs: Math.round(rendered.videoDurationMs),
          localDate: localDateString(new Date(info.endedAt)),
        },
        rendered.video,
        rendered.thumbnail,
        setProgress,
      );
      try {
        await markSessionSaved(info.sessionId);
      } catch {
        /* non-fatal */
      }
      try {
        await deleteFrames(info.sessionId);
      } catch {
        /* non-fatal */
      }
      onSaved(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setSaving(false);
    }
  }

  function discard() {
    if (window.confirm('Discard this session? The timelapse and its frames will be deleted.')) onDiscard();
  }

  return (
    <main className="page save-step">
      <header className="app-header">
        <h1 className="page-title">Save session</h1>
      </header>

      <div className="media-wrap">
        <video className="media" src={videoUrl} poster={posterUrl} controls playsInline loop muted autoPlay />
      </div>

      <dl className="stats-row">
        <div>
          <dt>Focus time</dt>
          <dd className="num">{formatDuration(info.focusMs)}</dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd className="num">{info.frameCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Timelapse</dt>
          <dd className="num">{formatVideoLength(rendered.videoDurationMs)}</dd>
        </div>
      </dl>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          <span>Title</span>
          <input
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleEdited(true);
            }}
            disabled={saving}
          />
        </label>
        <div className="chips" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={category === c}
              className={`chip chip-btn${category === c ? ' on' : ''}`}
              onClick={() => pickCategory(c)}
              disabled={saving}
            >
              {categoryMeta[c].emoji} {categoryMeta[c].label}
            </button>
          ))}
        </div>
        <label>
          <span>Description</span>
          <textarea
            value={description}
            rows={3}
            maxLength={2000}
            placeholder="What did you get done?"
            onChange={(e) => setDescription(e.target.value)}
            disabled={saving}
          />
        </label>
        <label>
          <span>Who can see this</span>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)} disabled={saving}>
            <option value="public">Public</option>
            <option value="followers">Followers</option>
            <option value="private">Only me</option>
          </select>
        </label>

        {saving && (
          <div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="muted small num">Uploading… {Math.round(progress * 100)}%</p>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}

        <div className="btn-row stack">
          <button type="submit" className="btn btn-primary btn-xl btn-block" disabled={saving}>
            {saving ? 'Saving…' : error ? 'Retry upload' : 'Save'}
          </button>
          <button type="button" className="btn btn-danger btn-block" onClick={discard} disabled={saving}>
            Discard
          </button>
        </div>
      </form>
    </main>
  );
}
