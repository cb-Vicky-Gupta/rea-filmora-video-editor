import { useEffect, useRef } from 'react';
import {
  ANIMATIONS,
  DEFAULT_ANIMATION_DURATION,
  DEFAULT_TRANSITION_DURATION,
  TRANSFORM_PROPS,
  TRANSITIONS,
  clipAudio,
  clipDur,
  clipEnd,
  clipSpeed,
  formatTime,
  isAnimated,
  localKeyframes,
  mainVideoTrack,
  mediaUrl,
  propAt,
  sourceTime,
  transitionInto,
  uid,
} from '../project.js';
import SpeedControls from './SpeedRamp.jsx';
import { DEFAULT_GRADE, LOOKS, clipGrade, makeGradeFn, parseCube } from '../../shared/grade.mjs';

const RESOLUTIONS = [
  { label: '4K (3840×2160)', width: 3840, height: 2160 },
  { label: '1080p (1920×1080)', width: 1920, height: 1080 },
  { label: '720p (1280×720)', width: 1280, height: 720 },
  { label: 'Vertical 1080×1920', width: 1080, height: 1920 },
  { label: 'Square 1080×1080', width: 1080, height: 1080 },
];

const MOD = window.api?.platform === 'darwin' ? '⌘' : 'Ctrl+';

const EQ_PRESETS = [
  { name: 'Flat', audio: { bass: 0, mid: 0, treble: 0, highpass: false } },
  { name: 'Voice', audio: { bass: -3, mid: 3, treble: 2, highpass: true } },
  { name: 'Bass boost', audio: { bass: 6, mid: 0, treble: 0, highpass: false } },
  { name: 'Bright', audio: { bass: -1, mid: 0, treble: 5, highpass: false } },
  { name: 'Warm', audio: { bass: 3, mid: 1, treble: -3, highpass: false } },
];

function Field({ label, children, extra }) {
  return (
    <label className="field">
      <span>
        {label}
        {extra}
      </span>
      {children}
    </label>
  );
}

function Slider({ value, min, max, step, onChange, format = (v) => v, disabled }) {
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(+e.target.value)}
      />
      <span className="slider-value">{format(value)}</span>
    </div>
  );
}

const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
const secs = (v) => `${v.toFixed(1)}s`;
const db = (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)} dB`;

// ---------------- Video: transform + keyframes ----------------

function KeyframeRow({ prop, clip, time, setTime, dispatch, fps }) {
  const spec = TRANSFORM_PROPS[prop];
  const dur = clipDur(clip);
  const local = Math.max(0, Math.min(dur, time - clip.start));
  const inClip = time >= clip.start - 1e-6 && time <= clipEnd(clip) + 1e-6;
  const animated = isAnimated(clip, prop);
  const value = propAt(clip, prop, local);
  const src = sourceTime(clip, Math.max(clip.start, Math.min(clipEnd(clip), time)));
  const tol = 0.5 / fps;
  const here = animated ? clip.keyframes[prop].find((k) => Math.abs(k.t - src) <= tol) : null;
  const kfs = localKeyframes(clip, prop) || [];
  const prev = [...kfs].reverse().find((k) => k.local < local - tol);
  const next = kfs.find((k) => k.local > local + tol);

  const setValue = (v) => {
    if (animated) {
      if (inClip) dispatch({ type: 'SET_KEYFRAME', clipId: clip.id, prop, t: src, v });
    } else {
      dispatch({
        type: 'UPDATE_CLIP',
        clipId: clip.id,
        patch: { transform: { ...clip.transform, [prop]: v } },
      });
    }
  };
  const fmt =
    prop === 'rotation'
      ? (v) => `${Math.round(v)}°`
      : prop === 'x' || prop === 'y'
        ? (v) => `${Math.round((v - 0.5) * 100)}`
        : pct;

  return (
    <div className="kf-row">
      <div className="kf-head">
        <span>{spec.label}</span>
        <div className="kf-buttons">
          <button
            className="icon"
            disabled={!prev}
            onClick={() => setTime(clip.start + prev.local)}
            title="Previous keyframe"
          >
            ◀
          </button>
          <button
            className={`icon diamond ${here ? 'on' : ''} ${animated ? 'animated' : ''}`}
            disabled={!inClip}
            title={here ? 'Remove keyframe' : 'Add keyframe at playhead'}
            onClick={() =>
              here
                ? dispatch({ type: 'REMOVE_KEYFRAME', clipId: clip.id, prop, t: here.t })
                : dispatch({ type: 'SET_KEYFRAME', clipId: clip.id, prop, t: src, v: value })
            }
          >
            ◆
          </button>
          <button
            className="icon"
            disabled={!next}
            onClick={() => setTime(clip.start + next.local)}
            title="Next keyframe"
          >
            ▶
          </button>
          {here && (
            <select
              className="ease"
              value={here.ease || 'linear'}
              onChange={(e) =>
                dispatch({
                  type: 'SET_KEYFRAME',
                  clipId: clip.id,
                  prop,
                  t: here.t,
                  v: here.v,
                  ease: e.target.value,
                })
              }
              title="Interpolation to the next keyframe"
            >
              <option value="linear">Linear</option>
              <option value="ease">Ease</option>
            </select>
          )}
          {animated && (
            <button
              className="icon"
              title="Remove all keyframes"
              onClick={() => dispatch({ type: 'CLEAR_KEYFRAMES', clipId: clip.id, prop, value })}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <Slider
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onChange={setValue}
        format={fmt}
        disabled={animated && !inClip}
      />
    </div>
  );
}

const PIP_PRESETS = [
  { name: 'Full', transform: { x: 0.5, y: 0.5, scale: 1 } },
  { name: '↖', transform: { x: 0.2, y: 0.2, scale: 0.33 } },
  { name: '↗', transform: { x: 0.8, y: 0.2, scale: 0.33 } },
  { name: '↙', transform: { x: 0.2, y: 0.8, scale: 0.33 } },
  { name: '↘', transform: { x: 0.8, y: 0.8, scale: 0.33 } },
  { name: 'Left half', transform: { x: 0.25, y: 0.5, scale: 0.5 } },
  { name: 'Right half', transform: { x: 0.75, y: 0.5, scale: 0.5 } },
];

export function VideoTab({
  project,
  clip,
  media,
  track,
  time,
  setTime,
  dispatch,
  showSpeed = true,
}) {
  const update = (patch) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch });
  const isOverlay = track !== mainVideoTrack(project);
  const dur = clipDur(clip);
  const maxFade = Math.max(0, Math.floor(dur * 10) / 20);
  const hasKeys = Object.values(clip.keyframes || {}).some((l) => l.length);

  return (
    <>
      <div className="section-title">
        Transform
        <button
          className="link"
          onClick={() => update({ transform: undefined, keyframes: undefined })}
          disabled={!clip.transform && !hasKeys}
        >
          Reset
        </button>
      </div>
      {isOverlay && (
        <>
          <div className="muted small">Picture in picture</div>
          <div className="chip-row">
            {PIP_PRESETS.map((p) => (
              <button
                key={p.name}
                className="chip"
                onClick={() =>
                  update({
                    transform: { ...clip.transform, ...p.transform },
                    keyframes: { ...clip.keyframes, x: [], y: [], scale: [] },
                  })
                }
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="hint small">
        Click ◆ to keyframe a property. Once a property has keyframes, moving its slider sets a
        keyframe at the playhead.
      </div>
      {Object.keys(TRANSFORM_PROPS).map((prop) => (
        <KeyframeRow
          key={prop}
          prop={prop}
          clip={clip}
          time={time}
          setTime={setTime}
          dispatch={dispatch}
          fps={project.settings.fps}
        />
      ))}

      {showSpeed && media?.kind === 'video' && (
        <>
          <div className="section-title">Speed</div>
          <SpeedControls key={clip.id} clip={clip} media={media} time={time} dispatch={dispatch} />
        </>
      )}

      <div className="section-title">Timing</div>
      {media?.kind === 'image' && (
        <Field label="Duration">
          <Slider
            value={dur}
            min={0.5}
            max={60}
            step={0.1}
            onChange={(v) => update({ in: 0, out: v })}
            format={secs}
          />
        </Field>
      )}
      <Field label="Fade in">
        <Slider
          value={Math.min(clip.fadeIn, maxFade)}
          min={0}
          max={maxFade}
          step={0.1}
          onChange={(v) => update({ fadeIn: v })}
          format={secs}
        />
      </Field>
      <Field label="Fade out">
        <Slider
          value={Math.min(clip.fadeOut, maxFade)}
          min={0}
          max={maxFade}
          step={0.1}
          onChange={(v) => update({ fadeOut: v })}
          format={secs}
        />
      </Field>
      {track.kind === 'video' && transitionInto(track, clip) && clip.fadeIn > 0 && (
        <div className="hint small">Fade in is skipped because this clip has a transition.</div>
      )}
    </>
  );
}

// ---------------- Color ----------------

const SWATCH_W = 96;
const SWATCH_H = 54;

export function LookSwatch({ thumb, grade }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const g2d = canvas.getContext('2d', { willReadFrequently: true });
    const paint = (img) => {
      if (img) {
        const s = Math.max(SWATCH_W / img.naturalWidth, SWATCH_H / img.naturalHeight);
        const w = img.naturalWidth * s;
        const h = img.naturalHeight * s;
        g2d.drawImage(img, (SWATCH_W - w) / 2, (SWATCH_H - h) / 2, w, h);
      } else {
        const grad = g2d.createLinearGradient(0, 0, SWATCH_W, SWATCH_H);
        grad.addColorStop(0, '#2d4f7c');
        grad.addColorStop(0.5, '#e0a35f');
        grad.addColorStop(1, '#f2e6d0');
        g2d.fillStyle = grad;
        g2d.fillRect(0, 0, SWATCH_W, SWATCH_H);
      }
      const data = g2d.getImageData(0, 0, SWATCH_W, SWATCH_H);
      const fn = makeGradeFn(grade, null);
      const d = data.data;
      for (let i = 0; i < d.length; i += 4) {
        let [r, g, b] = fn(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
        if (grade.vignette > 0) {
          const px = (i / 4) % SWATCH_W;
          const py = Math.floor(i / 4 / SWATCH_W);
          const dn =
            Math.hypot(px - SWATCH_W / 2, py - SWATCH_H / 2) /
            Math.hypot(SWATCH_W / 2, SWATCH_H / 2);
          const c = Math.cos((grade.vignette * Math.PI * dn) / 2) ** 4;
          r *= c;
          g *= c;
          b *= c;
        }
        d[i] = r * 255;
        d[i + 1] = g * 255;
        d[i + 2] = b * 255;
      }
      g2d.putImageData(data, 0, 0);
    };
    if (!thumb) return paint(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => paint(img);
    img.onerror = () => paint(null);
    img.src = mediaUrl(thumb);
  }, [thumb, grade]);
  return <canvas ref={ref} width={SWATCH_W} height={SWATCH_H} className="preset-swatch" />;
}

const sameGrade = (a, b) =>
  JSON.stringify({ ...a, lut: null, lutIntensity: 1 }) ===
  JSON.stringify({ ...b, lut: null, lutIntensity: 1 });

export function ColorTab({ clip, media, dispatch, notify }) {
  const grade = clipGrade(clip);
  const set = (patch) =>
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { grade: { ...grade, ...patch } } });
  const activeLook = LOOKS.find((l) => sameGrade(l.grade, grade));
  const slider = (key, label, min, max, step, format = signed) => (
    <Field label={label} key={key}>
      <Slider
        value={grade[key]}
        min={min}
        max={max}
        step={step}
        onChange={(v) => set({ [key]: v })}
        format={format}
      />
    </Field>
  );

  const importLut = async () => {
    try {
      const lut = await window.api.importLut();
      if (!lut) return;
      parseCube(await window.api.readLut(lut.path));
      set({ lut, lutIntensity: 1 });
    } catch (e) {
      notify(
        `Could not load LUT: ${String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`,
      );
    }
  };

  return (
    <>
      <div className="section-title">Looks</div>
      <div className="preset-grid">
        {LOOKS.map((l) => (
          <button
            key={l.id}
            className={`preset ${activeLook?.id === l.id ? 'active' : ''}`}
            onClick={() => set({ ...l.grade, lut: grade.lut, lutIntensity: grade.lutIntensity })}
            title={l.name}
          >
            <LookSwatch thumb={media?.thumb} grade={l.grade} />
            <span>{l.name}</span>
          </button>
        ))}
      </div>

      <div className="section-title">
        Light
        <button
          className="link"
          onClick={() => set(DEFAULT_GRADE)}
          disabled={sameGrade(grade, DEFAULT_GRADE) && !grade.lut}
        >
          Reset all
        </button>
      </div>
      {slider('exposure', 'Exposure', -2, 2, 0.01, (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`)}
      {slider('contrast', 'Contrast', -1, 1, 0.01)}
      {slider('highlights', 'Highlights', -1, 1, 0.01)}
      {slider('shadows', 'Shadows', -1, 1, 0.01)}
      {slider('whites', 'Whites', -1, 1, 0.01)}
      {slider('blacks', 'Blacks', -1, 1, 0.01)}

      <div className="section-title">Color</div>
      {slider('temperature', 'Temperature', -1, 1, 0.01)}
      {slider('tint', 'Tint', -1, 1, 0.01)}
      {slider('saturation', 'Saturation', -1, 1, 0.01)}
      {slider('vibrance', 'Vibrance', -1, 1, 0.01)}
      {slider('hue', 'Hue shift', -180, 180, 1, (v) => `${v}°`)}

      <div className="section-title">Split toning</div>
      {[
        ['shadowTint', 'Shadows'],
        ['highlightTint', 'Highlights'],
      ].map(([key, label]) => (
        <div key={key} className="tone-row">
          <Field label={`${label} hue`}>
            <div className="slider">
              <input
                type="range"
                className="hue-range"
                min={0}
                max={360}
                step={1}
                value={grade[key].hue}
                onChange={(e) => set({ [key]: { ...grade[key], hue: +e.target.value } })}
              />
              <span className="tone-dot" style={{ background: `hsl(${grade[key].hue} 80% 55%)` }} />
            </div>
          </Field>
          <Field label={`${label} amount`}>
            <Slider
              value={grade[key].amount}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => set({ [key]: { ...grade[key], amount: v } })}
              format={pct}
            />
          </Field>
        </div>
      ))}

      <div className="section-title">Effects</div>
      {slider('fade', 'Fade', 0, 1, 0.01, pct)}
      {slider('vignette', 'Vignette', 0, 1, 0.01, pct)}

      <div className="section-title">
        LUT
        <button className="link" onClick={importLut}>
          {grade.lut ? 'Replace…' : 'Import .cube…'}
        </button>
      </div>
      {grade.lut ? (
        <>
          <div className="lut-name">
            <span title={grade.lut.path}>{grade.lut.name}</span>
            <button className="link" onClick={() => set({ lut: null })}>
              Remove
            </button>
          </div>
          {slider('lutIntensity', 'Intensity', 0, 1, 0.01, pct)}
        </>
      ) : (
        <div className="hint small">Apply any 3D LUT (.cube) from a colorist or camera maker.</div>
      )}

      <button onClick={() => dispatch({ type: 'APPLY_GRADE_ALL', grade })}>
        Apply this grade to all video clips
      </button>
    </>
  );
}

// ---------------- Audio ----------------

export function AudioTab({ clip, media, track, dispatch }) {
  const update = (patch) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch });
  const fx = clipAudio(clip);
  const setFx = (patch) => update({ audio: { ...fx, ...patch } });
  const dur = clipDur(clip);
  const maxFade = Math.max(0, Math.floor(dur * 10) / 20);
  const isVideoTrack = track.kind === 'video';

  if (isVideoTrack && clip.audioDetached) {
    return (
      <div className="hint">This clip's audio was detached to an audio track. Edit it there.</div>
    );
  }

  return (
    <>
      <Field label="Volume">
        <Slider
          value={clip.volume}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => update({ volume: v })}
          format={pct}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={clip.muted}
          onChange={(e) => update({ muted: e.target.checked })}
        />
        Mute
      </label>
      {!isVideoTrack && (
        <>
          <Field label="Fade in">
            <Slider
              value={Math.min(clip.fadeIn, maxFade)}
              min={0}
              max={maxFade}
              step={0.1}
              onChange={(v) => update({ fadeIn: v })}
              format={secs}
            />
          </Field>
          <Field label="Fade out">
            <Slider
              value={Math.min(clip.fadeOut, maxFade)}
              min={0}
              max={maxFade}
              step={0.1}
              onChange={(v) => update({ fadeOut: v })}
              format={secs}
            />
          </Field>
          <Field label="Speed">
            <Slider
              value={clipSpeed(clip)}
              min={0.5}
              max={2}
              step={0.05}
              onChange={(v) => dispatch({ type: 'SET_SPEED', clipId: clip.id, speed: v })}
              format={(v) => `${v.toFixed(2)}×`}
            />
          </Field>
        </>
      )}

      <div className="section-title">Equalizer</div>
      <div className="chip-row">
        {EQ_PRESETS.map((p) => (
          <button
            key={p.name}
            className={`chip ${['bass', 'mid', 'treble', 'highpass'].every((k) => p.audio[k] === fx[k]) ? 'active' : ''}`}
            onClick={() => setFx(p.audio)}
          >
            {p.name}
          </button>
        ))}
      </div>
      <Field label="Bass (100 Hz)">
        <Slider
          value={fx.bass}
          min={-12}
          max={12}
          step={0.5}
          onChange={(v) => setFx({ bass: v })}
          format={db}
        />
      </Field>
      <Field label="Mid (1 kHz)">
        <Slider
          value={fx.mid}
          min={-12}
          max={12}
          step={0.5}
          onChange={(v) => setFx({ mid: v })}
          format={db}
        />
      </Field>
      <Field label="Treble (3 kHz)">
        <Slider
          value={fx.treble}
          min={-12}
          max={12}
          step={0.5}
          onChange={(v) => setFx({ treble: v })}
          format={db}
        />
      </Field>

      <div className="section-title">Clean up</div>
      <label className="check">
        <input
          type="checkbox"
          checked={fx.highpass}
          onChange={(e) => setFx({ highpass: e.target.checked })}
        />
        Remove rumble (high-pass 80 Hz)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={fx.denoise}
          onChange={(e) => setFx({ denoise: e.target.checked })}
        />
        Reduce background noise
      </label>
      {fx.denoise && <div className="hint small">Noise reduction is applied when exporting.</div>}

      {isVideoTrack && media?.hasAudio && (
        <button onClick={() => dispatch({ type: 'DETACH_AUDIO', clipId: clip.id, newId: uid() })}>
          Detach audio to its own track
        </button>
      )}
    </>
  );
}

// ---------------- Transition ----------------

export function TransitionTab({ clip, track, dispatch }) {
  const hasPrev = track.clips.some((c) => c !== clip && Math.abs(clipEnd(c) - clip.start) < 0.001);
  const current = clip.transition;
  const maxDur = Math.max(0.1, Math.min(3, clipDur(clip)));
  const set = (transition) => dispatch({ type: 'SET_TRANSITION', clipId: clip.id, transition });

  return (
    <>
      <div className="hint small">
        {hasPrev
          ? 'Plays from the previous clip into this one.'
          : 'No clip ends right where this one starts, so it transitions in from black. Butt clips together (they snap) to transition between them.'}
      </div>
      {current && (
        <button className="danger" onClick={() => set(null)}>
          Remove transition
        </button>
      )}
      <div className="transition-grid">
        <button className={`chip ${!current ? 'active' : ''}`} onClick={() => set(null)}>
          None
        </button>
        {TRANSITIONS.map((t) => (
          <button
            key={t.id}
            className={`chip ${current?.type === t.id ? 'active' : ''}`}
            onClick={() =>
              set({ type: t.id, duration: current?.duration || DEFAULT_TRANSITION_DURATION })
            }
          >
            {t.name}
          </button>
        ))}
      </div>
      {current && (
        <Field label="Duration">
          <Slider
            value={Math.min(current.duration, maxDur)}
            min={0.1}
            max={maxDur}
            step={0.05}
            onChange={(v) => set({ ...current, duration: v })}
            format={secs}
          />
        </Field>
      )}
      {current && !transitionInto(track, clip) && (
        <div className="hint small">This clip is too short for the transition.</div>
      )}
    </>
  );
}

// ---------------- Animation ----------------

export function AnimationTab({ clip, isText, dispatch }) {
  const list = ANIMATIONS.filter((a) => !isText || a.text);
  const maxDur = Math.max(0.1, Math.min(3, clipDur(clip)));
  return (
    <>
      <div className="hint small">
        In animations play at the start of the clip, Out animations at its end. They work on any
        clip and combine with keyframes.
      </div>
      {[
        ['in', 'In', clip.animIn],
        ['out', 'Out', clip.animOut],
      ].map(([dir, label, current]) => {
        const set = (animation) =>
          dispatch({ type: 'SET_ANIMATION', clipId: clip.id, dir, animation });
        return (
          <div key={dir} className="anim-section">
            <div className="section-title">{label} animation</div>
            <div className="transition-grid">
              <button className={`chip ${!current ? 'active' : ''}`} onClick={() => set(null)}>
                None
              </button>
              {list.map((a) => (
                <button
                  key={a.id}
                  className={`chip ${current?.type === a.id ? 'active' : ''}`}
                  onClick={() =>
                    set({
                      type: a.id,
                      duration: current?.duration ?? Math.min(DEFAULT_ANIMATION_DURATION, maxDur),
                    })
                  }
                >
                  {a.name}
                </button>
              ))}
            </div>
            {current && (
              <Field label="Duration">
                <Slider
                  value={Math.min(current.duration, maxDur)}
                  min={0.1}
                  max={maxDur}
                  step={0.05}
                  onChange={(v) => set({ ...current, duration: v })}
                  format={secs}
                />
              </Field>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---------------- Inspector ----------------

export function ProjectFields({ project, dispatch }) {
  const { width, height, fps } = project.settings;
  const current = RESOLUTIONS.findIndex((r) => r.width === width && r.height === height);
  return (
    <>
      <Field label="Resolution">
        <select
          value={current}
          onChange={(e) => {
            const r = RESOLUTIONS[+e.target.value];
            dispatch({ type: 'SET_SETTINGS', patch: { width: r.width, height: r.height } });
          }}
        >
          {RESOLUTIONS.map((r, i) => (
            <option key={r.label} value={i}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Frame rate">
        <select
          value={fps}
          onChange={(e) => dispatch({ type: 'SET_SETTINGS', patch: { fps: +e.target.value } })}
        >
          {[24, 25, 30, 50, 60].map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function ProjectSettings({ project, dispatch }) {
  return (
    <section className="panel inspector">
      <div className="panel-header">
        <span>Project</span>
      </div>
      <div className="inspector-body">
        <ProjectFields project={project} dispatch={dispatch} />
        <div className="hint">
          Select a clip on the timeline to edit it.
          <ul>
            <li>
              <kbd>Space</kbd> play / pause
            </li>
            <li>
              <kbd>S</kbd> split at playhead
            </li>
            <li>
              <kbd>K</kbd> keyframe position, scale, rotation and opacity at the playhead
            </li>
            <li>
              <kbd>⌫</kbd> delete clip
            </li>
            <li>
              <kbd>{MOD}Z</kbd> / <kbd>{MOD}⇧Z</kbd> undo / redo
            </li>
            <li>
              <kbd>←</kbd> <kbd>→</kbd> step one frame
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export function TitleTab({ clip, dispatch }) {
  const update = (patch) => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch });
  const dur = clipDur(clip);
  return (
    <>
      <Field label="Text">
        <textarea rows={3} value={clip.text} onChange={(e) => update({ text: e.target.value })} />
      </Field>
      <Field label="Size">
        <Slider
          value={clip.fontSize}
          min={16}
          max={240}
          step={1}
          onChange={(v) => update({ fontSize: v })}
        />
      </Field>
      <Field label="Color">
        <input
          type="color"
          value={clip.color}
          onChange={(e) => update({ color: e.target.value })}
        />
      </Field>
      <Field label="Horizontal">
        <Slider
          value={clip.x}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => update({ x: v })}
          format={pct}
        />
      </Field>
      <Field label="Vertical">
        <Slider
          value={clip.y}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => update({ y: v })}
          format={pct}
        />
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={clip.box}
          onChange={(e) => update({ box: e.target.checked })}
        />
        Background box
      </label>
      <Field label="Duration">
        <Slider
          value={dur}
          min={0.5}
          max={30}
          step={0.1}
          onChange={(v) => update({ in: 0, out: v })}
          format={secs}
        />
      </Field>
    </>
  );
}

export default function Inspector({
  project,
  selected,
  dispatch,
  time,
  setTime,
  tab,
  setTab,
  notify,
}) {
  if (!selected) return <ProjectSettings project={project} dispatch={dispatch} />;

  const { track, clip } = selected;
  const media = project.media[clip.mediaId];
  const dur = clipDur(clip);

  let tabs;
  if (track.kind === 'text')
    tabs = [
      ['title', 'Title'],
      ['animation', 'Animation'],
    ];
  else if (track.kind === 'audio') tabs = [['audio', 'Audio']];
  else {
    tabs = [
      ['video', media?.kind === 'image' ? 'Image' : 'Video'],
      ['color', 'Color'],
      ['animation', 'Animation'],
    ];
    if (media?.hasAudio) tabs.push(['audio', 'Audio']);
    if (track === mainVideoTrack(project)) tabs.push(['transition', 'Transition']);
  }
  const active = tabs.some(([id]) => id === tab) ? tab : tabs[0][0];

  return (
    <section className="panel inspector">
      <div className="panel-header tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={`tab ${active === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="inspector-body">
        {media && (
          <div className="inspector-name" title={media.path}>
            {media.name}
          </div>
        )}
        <div className="muted small">
          {formatTime(clip.start)} → {formatTime(clip.start + dur)} ({dur.toFixed(2)}s)
        </div>

        {active === 'title' && <TitleTab clip={clip} dispatch={dispatch} />}
        {active === 'video' && (
          <VideoTab
            project={project}
            clip={clip}
            media={media}
            track={track}
            time={time}
            setTime={setTime}
            dispatch={dispatch}
          />
        )}
        {active === 'color' && (
          <ColorTab clip={clip} media={media} dispatch={dispatch} notify={notify} />
        )}
        {active === 'audio' && (
          <AudioTab clip={clip} media={media} track={track} dispatch={dispatch} />
        )}
        {active === 'transition' && <TransitionTab clip={clip} track={track} dispatch={dispatch} />}
        {active === 'animation' && (
          <AnimationTab clip={clip} isText={track.kind === 'text'} dispatch={dispatch} />
        )}

        <button
          className="danger"
          onClick={() => dispatch({ type: 'DELETE_CLIP', clipId: clip.id })}
        >
          Delete clip
        </button>
      </div>
    </section>
  );
}
