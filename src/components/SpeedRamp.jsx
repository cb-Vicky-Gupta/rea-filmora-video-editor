import { useRef, useState } from 'react';
import {
  RAMP_MAX,
  RAMP_MIN,
  RAMP_PRESETS,
  clipDur,
  clipSpeed,
  hasRamp,
  normalizeRamp,
  sourceTime,
} from '../project.js';

const W = 320;
const H = 150;
const PAD_L = 30; // room for the speed labels
const PAD_R = 12;
const PAD_Y = 12;
const GRID = [0.25, 0.5, 1, 2, 4];
const HIT_PX = 16;
const LOG_MIN = Math.log(RAMP_MIN);
const LOG_SPAN = Math.log(RAMP_MAX) - LOG_MIN;

// Speeds are drawn on a log scale so 0.5× and 2× sit equally far from 1×.
const yOf = (s) => PAD_Y + (1 - (Math.log(s) - LOG_MIN) / LOG_SPAN) * (H - 2 * PAD_Y);
const sOf = (y) => Math.exp(LOG_MIN + (1 - (y - PAD_Y) / (H - 2 * PAD_Y)) * LOG_SPAN);
const xOf = (x) => PAD_L + x * (W - PAD_L - PAD_R);
const xFrom = (px) => (px - PAD_L) / (W - PAD_L - PAD_R);

const curvePath = (points, w, h, pad = 0) =>
  points
    .map((p, i) => {
      const x = pad + p.x * (w - 2 * pad);
      const y = pad + (1 - (Math.log(p.s) - LOG_MIN) / LOG_SPAN) * (h - 2 * pad);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

const fmtSpeed = (s) => `${s < 1 ? s.toFixed(2) : s.toFixed(1)}×`;

function RampEditor({ clip, time, onCommit }) {
  const svgRef = useRef(null);
  const [draft, setDraft] = useState(null); // points while dragging
  const [sel, setSel] = useState(null);
  const dragRef = useRef(null);
  const points = draft || clip.ramp.points;

  const toLocal = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return {
      px: ((e.clientX - r.left) / r.width) * W,
      py: ((e.clientY - r.top) / r.height) * H,
      scale: r.width / W,
    };
  };

  const onDown = (e) => {
    e.preventDefault();
    const { px, py, scale } = toLocal(e);
    let idx = points.findIndex((p) => Math.hypot(xOf(p.x) - px, yOf(p.s) - py) * scale < HIT_PX);
    let pts = points;
    if (idx < 0) {
      // Tap on the curve area adds a point there.
      const x = Math.max(0.001, Math.min(0.999, xFrom(px)));
      const s = Math.max(RAMP_MIN, Math.min(RAMP_MAX, sOf(py)));
      pts = normalizeRamp([...points, { x, s }]);
      idx = pts.findIndex((p) => p.x === x);
    }
    setSel(idx);
    setDraft(pts);
    dragRef.current = { idx, pts };
    svgRef.current.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const { px, py } = toLocal(e);
    const pts = d.pts.map((p) => ({ ...p }));
    const i = d.idx;
    const p = pts[i];
    p.s = Math.max(RAMP_MIN, Math.min(RAMP_MAX, sOf(py)));
    // Snap to 1× for an easy return to normal speed.
    if (Math.abs(Math.log(p.s)) < 0.06) p.s = 1;
    if (i > 0 && i < pts.length - 1) {
      p.x = Math.max(pts[i - 1].x + 0.01, Math.min(pts[i + 1].x - 0.01, xFrom(px)));
    }
    d.pts = pts;
    setDraft(pts);
  };

  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    setDraft(null);
    onCommit(d.pts);
  };

  const removeSel = () => {
    if (sel == null || sel === 0 || sel === points.length - 1) return;
    onCommit(points.filter((_, i) => i !== sel));
    setSel(null);
  };

  const L = clip.out - clip.in;
  const inClip = time >= clip.start && time <= clip.start + clipDur(clip);
  const headX = inClip && L > 0 ? (sourceTime(clip, time) - clip.in) / L : null;
  const selPoint = sel != null ? points[sel] : null;
  const canDelete = selPoint && sel > 0 && sel < points.length - 1;

  return (
    <div className="ramp-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="ramp-svg"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {GRID.map((g) => (
          <g key={g}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yOf(g)}
              y2={yOf(g)}
              className={g === 1 ? 'ramp-grid one' : 'ramp-grid'}
            />
            <text x={PAD_L - 6} y={yOf(g) + 3} className="ramp-grid-label">
              {g}×
            </text>
          </g>
        ))}
        <path
          d={points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.x)},${yOf(p.s)}`).join(' ')}
          className="ramp-line"
        />
        {headX != null && (
          <line x1={xOf(headX)} x2={xOf(headX)} y1={4} y2={H - 4} className="ramp-head" />
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xOf(p.x)}
            cy={yOf(p.s)}
            r={sel === i ? 7 : 5.5}
            className={`ramp-point ${sel === i ? 'sel' : ''}`}
          />
        ))}
      </svg>
      <div className="ramp-meta">
        <span className="muted small">
          {selPoint
            ? `Point: ${fmtSpeed(selPoint.s)}`
            : 'Drag points up for faster, down for slower. Tap to add a point.'}
        </span>
        {canDelete && (
          <button className="link" onClick={removeSel}>
            Delete point
          </button>
        )}
      </div>
    </div>
  );
}

// Constant speed or a speed ramp for a video clip.
export default function SpeedControls({ clip, media, time, dispatch }) {
  const ramped = hasRamp(clip);
  const [mode, setMode] = useState(ramped ? 'curve' : 'normal');
  const speed = clipSpeed(clip);
  const srcLen = clip.out - clip.in;
  const setRamp = (ramp) => dispatch({ type: 'SET_RAMP', clipId: clip.id, ramp });
  const setSpeed = (v) => dispatch({ type: 'SET_SPEED', clipId: clip.id, speed: v });

  return (
    <div className="speed-controls">
      <div className="segmented speed-mode">
        <button className={mode === 'normal' ? 'active' : ''} onClick={() => setMode('normal')}>
          Normal
        </button>
        <button className={mode === 'curve' ? 'active' : ''} onClick={() => setMode('curve')}>
          Speed ramp
        </button>
      </div>

      {mode === 'normal' && (
        <>
          {ramped && (
            <div className="hint small">
              This clip uses a speed ramp. Picking a speed below replaces it.
            </div>
          )}
          <div className="slider">
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={ramped ? 1 : speed}
              onChange={(e) => setSpeed(+e.target.value)}
            />
            <span className="slider-value">{ramped ? '—' : `${speed.toFixed(2)}×`}</span>
          </div>
          <div className="chip-row">
            {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
              <button
                key={s}
                className={`chip ${!ramped && Math.abs(s - speed) < 0.001 ? 'active' : ''}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        </>
      )}

      {mode === 'curve' && (
        <>
          <div className="ramp-presets">
            <button
              className={`ramp-tile ${!ramped ? 'active' : ''}`}
              onClick={() => setRamp(null)}
              title="No ramp"
            >
              <svg viewBox="0 0 60 34" className="ramp-thumb">
                <path d="M4,17 L56,17" />
              </svg>
              <span>None</span>
            </button>
            {RAMP_PRESETS.map((p) => (
              <button
                key={p.id}
                className={`ramp-tile ${clip.ramp?.id === p.id ? 'active' : ''}`}
                onClick={() => setRamp({ id: p.id, points: p.points })}
              >
                <svg viewBox="0 0 60 34" className="ramp-thumb">
                  <path d={curvePath(p.points, 60, 34, 4)} />
                </svg>
                <span>{p.name}</span>
              </button>
            ))}
            <button
              className={`ramp-tile ${clip.ramp?.id === 'custom' ? 'active' : ''}`}
              onClick={() =>
                setRamp({
                  id: 'custom',
                  points: ramped
                    ? clip.ramp.points
                    : [
                        { x: 0, s: speed },
                        { x: 0.5, s: speed },
                        { x: 1, s: speed },
                      ],
                })
              }
            >
              <svg viewBox="0 0 60 34" className="ramp-thumb">
                <path d="M4,22 L20,22 L30,10 L40,22 L56,22" />
              </svg>
              <span>Custom</span>
            </button>
          </div>
          {ramped && (
            <>
              <RampEditor
                key={clip.id}
                clip={clip}
                time={time}
                onCommit={(points) => setRamp({ id: 'custom', points: normalizeRamp(points) })}
              />
              <div className="ramp-summary">
                <span>
                  {srcLen.toFixed(1)}s → <b>{clipDur(clip).toFixed(1)}s</b>
                </span>
                <span className="muted">
                  {fmtSpeed(Math.min(...clip.ramp.points.map((p) => p.s)))} –{' '}
                  {fmtSpeed(Math.max(...clip.ramp.points.map((p) => p.s)))}
                </span>
              </div>
              {media?.hasAudio && (
                <div className="hint small">
                  Sound follows the ramp with its pitch kept. Mute the clip for a silent slow-motion
                  look.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
