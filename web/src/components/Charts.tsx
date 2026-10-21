import type { Stats } from '@shared/types';
import { categoryMeta, formatDuration } from '../lib/format';

/** 12-week bar chart in plain SVG. Last bar (current week) is accented. */
export function WeeklyBars({ weeks }: { weeks: Stats['weeks'] }) {
  const W = 360;
  const H = 170;
  const padX = 8;
  const top = 22;
  const bottom = 24;
  const n = weeks.length || 1;
  const slot = (W - padX * 2) / n;
  const barW = Math.min(20, slot * 0.62);
  const max = Math.max(60, ...weeks.map((w) => w.focusMin));
  const plotH = H - top - bottom;
  const label = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const total = weeks.reduce((a, w) => a + w.focusMin, 0);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="chart weekly"
      role="img"
      aria-label={`Focus hours over the last ${weeks.length} weeks, ${(total / 60).toFixed(1)} hours total`}
    >
      <line x1={padX} x2={W - padX} y1={H - bottom} y2={H - bottom} className="chart-axis" />
      {weeks.map((w, i) => {
        const h = Math.max(w.focusMin > 0 ? 3 : 1.5, (w.focusMin / max) * plotH);
        const x = padX + i * slot + (slot - barW) / 2;
        const y = H - bottom - h;
        const current = i === weeks.length - 1;
        const hours = w.focusMin / 60;
        return (
          <g key={w.weekStart}>
            <rect
              className={`bar${current ? ' current' : ''}`}
              data-testid="week-bar"
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={4}
            >
              <title>{`Week of ${w.weekStart}: ${hours.toFixed(1)}h`}</title>
            </rect>
            {w.focusMin > 0 && (
              <text x={x + barW / 2} y={y - 5} textAnchor="middle" className={`chart-val${current ? ' current' : ''}`}>
                {hours >= 10 ? Math.round(hours) : hours.toFixed(1)}
              </text>
            )}
            {(i % 3 === 0 || current) && (
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" className="chart-lbl">
                {label(w.weekStart)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Weekly goal ring. */
export function ProgressRing({ valueMin, goalMin, size = 124 }: { valueMin: number; goalMin: number; size?: number }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = goalMin > 0 ? Math.min(1, valueMin / goalMin) : 0;
  const pct = goalMin > 0 ? Math.round((valueMin / goalMin) * 100) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${pct}% of weekly goal`}
      >
        <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="ring-fill"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          data-testid="ring-fill"
        />
      </svg>
      <div className="ring-center">
        <span className="num ring-pct">{pct}%</span>
        <span className="muted tiny">{(valueMin / 60).toFixed(1)}h / {+(goalMin / 60).toFixed(1)}h</span>
      </div>
    </div>
  );
}

export function CategoryBars({ data }: { data: Stats['byCategory'] }) {
  const rows = [...data].filter((d) => d.focusMin > 0).sort((a, b) => b.focusMin - a.focusMin);
  if (rows.length === 0) return <p className="muted small">No category data yet.</p>;
  const max = rows[0].focusMin;
  return (
    <ul className="cat-bars">
      {rows.map((r) => {
        const m = categoryMeta[r.category] ?? categoryMeta.other;
        return (
          <li key={r.category}>
            <span className="cat-name">
              <span aria-hidden="true">{m.emoji}</span> {m.label}
            </span>
            <span className="cat-track">
              <span className="cat-fill" style={{ width: `${Math.max(4, (r.focusMin / max) * 100)}%` }} />
            </span>
            <span className="num cat-val">{formatDuration(r.focusMin * 60000)}</span>
          </li>
        );
      })}
    </ul>
  );
}
