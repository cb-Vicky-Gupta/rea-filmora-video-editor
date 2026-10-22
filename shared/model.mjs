// Timeline rules shared by the renderer (preview) and the main process (export), so both
// agree on timing, keyframes and transitions.
//
// Every clip uses { start, in, out, speed }: `start` is its position on the timeline,
// `in`/`out` are source timestamps and `(out - in) / speed` is its length on the timeline.
// A speed ramp (`clip.ramp`) replaces the constant speed with a curve; `clipSpeed` is then the
// ramp's average speed, so `(out - in) / clipSpeed` still gives the length on the timeline.

export const EPS = 0.001;
export const MIN_CLIP = 0.1;

// ---- Speed ramps ----
// clip.ramp = { id, points: [{ x, s }] }: `x` runs 0..1 across the clip's source range and `s`
// is the playback speed there; speed changes linearly between points. Because `x` is relative,
// the curve stretches with the clip when it is trimmed.
export const RAMP_MIN = 0.1;
export const RAMP_MAX = 10;

export const RAMP_PRESETS = [
  {
    id: 'montage',
    name: 'Montage',
    points: [
      [0, 2.5],
      [0.35, 2.5],
      [0.45, 0.4],
      [0.55, 0.4],
      [0.65, 2.5],
      [1, 2.5],
    ],
  },
  {
    id: 'hero',
    name: 'Hero Moment',
    points: [
      [0, 1],
      [0.38, 1],
      [0.48, 0.25],
      [0.58, 0.25],
      [0.68, 1],
      [1, 1],
    ],
  },
  {
    id: 'bullet',
    name: 'Bullet Time',
    points: [
      [0, 3],
      [0.4, 3],
      [0.5, 0.15],
      [0.6, 3],
      [1, 3],
    ],
  },
  {
    id: 'flash-in',
    name: 'Flash In',
    points: [
      [0, 5],
      [0.3, 5],
      [0.45, 1],
      [1, 1],
    ],
  },
  {
    id: 'flash-out',
    name: 'Flash Out',
    points: [
      [0, 1],
      [0.55, 1],
      [0.7, 5],
      [1, 5],
    ],
  },
  {
    id: 'jump-cut',
    name: 'Jump Cut',
    points: [
      [0, 1],
      [0.25, 1],
      [0.3, 6],
      [0.4, 6],
      [0.45, 1],
      [0.7, 1],
      [0.75, 6],
      [0.85, 6],
      [0.9, 1],
      [1, 1],
    ],
  },
  {
    id: 'speed-up',
    name: 'Speed Up',
    points: [
      [0, 0.5],
      [1, 3],
    ],
  },
  {
    id: 'slow-down',
    name: 'Slow Down',
    points: [
      [0, 3],
      [1, 0.5],
    ],
  },
].map((p) => ({ ...p, points: p.points.map(([x, s]) => ({ x, s })) }));

const clampSpeed = (s) => Math.max(RAMP_MIN, Math.min(RAMP_MAX, s));

// Sorted, clamped points spanning x = 0..1 (missing ends repeat the nearest speed).
export function normalizeRamp(points) {
  const pts = points
    .map((p) => ({ x: Math.max(0, Math.min(1, p.x)), s: clampSpeed(p.s) }))
    .sort((a, b) => a.x - b.x);
  if (!pts.length)
    return [
      { x: 0, s: 1 },
      { x: 1, s: 1 },
    ];
  if (pts[0].x > 0) pts.unshift({ x: 0, s: pts[0].s });
  if (pts[pts.length - 1].x < 1) pts.push({ x: 1, s: pts[pts.length - 1].s });
  return pts;
}

// Timeline time (in units of the source length) to play from x0 to x0 + dx when the speed
// goes linearly from s0 (at x0) to s1 (at x0 + span).
function segmentTime(dx, span, s0, s1) {
  if (Math.abs(s1 - s0) < 1e-9) return dx / s0;
  const k = (s1 - s0) / span;
  return Math.log(1 + (k * dx) / s0) / k;
}

const tables = new WeakMap();
// Cumulative timeline times at each point, cached per points array.
function rampTable(points) {
  let tbl = tables.get(points);
  if (tbl) return tbl;
  const T = [0];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    T.push(T[i] + (b.x > a.x ? segmentTime(b.x - a.x, b.x - a.x, a.s, b.s) : 0));
  }
  tbl = { T, total: T[T.length - 1] };
  tables.set(points, tbl);
  return tbl;
}

const rampPoints = (c) => (c.ramp?.points?.length >= 2 ? c.ramp.points : null);

export const clipSpeed = (c) => {
  const pts = rampPoints(c);
  return pts ? 1 / rampTable(pts).total : c.speed || 1;
};
export const clipDur = (c) => (c.out - c.in) / clipSpeed(c);
export const clipEnd = (c) => c.start + clipDur(c);

// Ramp position x (0..1, may run past 1) reached after normalized timeline time `tn`.
function rampXAt(points, tn) {
  const { T, total } = rampTable(points);
  const last = points[points.length - 1];
  if (tn <= 0) return tn * points[0].s;
  if (tn >= total) return 1 + (tn - total) * last.s;
  let i = 0;
  while (i < points.length - 2 && T[i + 1] <= tn) i++;
  const a = points[i];
  const b = points[i + 1];
  const span = b.x - a.x;
  const d = tn - T[i];
  if (Math.abs(b.s - a.s) < 1e-9) return a.x + d * a.s;
  const k = (b.s - a.s) / span;
  return a.x + (a.s * (Math.exp(k * d) - 1)) / k;
}

// Normalized timeline time at ramp position x (inverse of rampXAt).
function rampTimeAt(points, x) {
  const { T, total } = rampTable(points);
  if (x <= 0) return x / points[0].s;
  if (x >= 1) return total + (x - 1) / points[points.length - 1].s;
  let i = 0;
  while (i < points.length - 2 && points[i + 1].x <= x) i++;
  const a = points[i];
  const b = points[i + 1];
  return T[i] + segmentTime(x - a.x, b.x - a.x, a.s, b.s);
}

// Speed of the curve at ramp position x.
export function rampSpeedAt(points, x) {
  if (x <= points[0].x) return points[0].s;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (x <= b.x) return b.x > a.x ? a.s + ((b.s - a.s) * (x - a.x)) / (b.x - a.x) : b.s;
  }
  return points[points.length - 1].s;
}

// Source timestamp shown at timeline time `t` (may run past `out` during a transition).
export function sourceTime(c, t) {
  const pts = rampPoints(c);
  const L = c.out - c.in;
  if (!pts || L <= 0) return c.in + (t - c.start) * clipSpeed(c);
  return c.in + L * rampXAt(pts, (t - c.start) / L);
}

// Clip-local timeline time at which source timestamp `src` plays.
export function localTimeOf(c, src) {
  const pts = rampPoints(c);
  const L = c.out - c.in;
  if (!pts || L <= 0) return (src - c.in) / clipSpeed(c);
  return L * rampTimeAt(pts, (src - c.in) / L);
}

// Playback speed at timeline time `t`.
export function speedAt(c, t) {
  const pts = rampPoints(c);
  const L = c.out - c.in;
  if (!pts || L <= 0) return clipSpeed(c);
  const x = rampXAt(pts, (t - c.start) / L);
  return rampSpeedAt(pts, Math.max(0, Math.min(1, x)));
}

export const hasRamp = (c) => !!rampPoints(c);

// Splits a ramp at ramp position xc into the parts before and after, each spanning 0..1.
export function splitRamp(ramp, xc) {
  const pts = ramp.points;
  const sc = rampSpeedAt(pts, xc);
  const left = [...pts.filter((p) => p.x < xc - 1e-6), { x: xc, s: sc }].map((p) => ({
    x: p.x / xc,
    s: p.s,
  }));
  const right = [{ x: xc, s: sc }, ...pts.filter((p) => p.x > xc + 1e-6)].map((p) => ({
    x: (p.x - xc) / (1 - xc),
    s: p.s,
  }));
  return [
    { id: 'custom', points: normalizeRamp(left) },
    { id: 'custom', points: normalizeRamp(right) },
  ];
}

export function projectDuration(project) {
  let end = 0;
  for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

// ---- Transitions ----
// Names are ffmpeg xfade transition ids; the preview shader implements the same formulas.
export const TRANSITIONS = [
  { id: 'fade', name: 'Dissolve' },
  { id: 'fadeblack', name: 'Dip to Black' },
  { id: 'fadewhite', name: 'Dip to White' },
  { id: 'wipeleft', name: 'Wipe Left' },
  { id: 'wiperight', name: 'Wipe Right' },
  { id: 'wipeup', name: 'Wipe Up' },
  { id: 'wipedown', name: 'Wipe Down' },
  { id: 'slideleft', name: 'Slide Left' },
  { id: 'slideright', name: 'Slide Right' },
  { id: 'slideup', name: 'Slide Up' },
  { id: 'slidedown', name: 'Slide Down' },
  { id: 'smoothleft', name: 'Smooth Left' },
  { id: 'smoothright', name: 'Smooth Right' },
  { id: 'smoothup', name: 'Smooth Up' },
  { id: 'smoothdown', name: 'Smooth Down' },
  { id: 'circleopen', name: 'Circle Open' },
  { id: 'circleclose', name: 'Circle Close' },
  { id: 'circlecrop', name: 'Iris' },
  { id: 'rectcrop', name: 'Box' },
  { id: 'radial', name: 'Clock' },
  { id: 'horzopen', name: 'Barn Door H' },
  { id: 'vertopen', name: 'Barn Door V' },
  { id: 'dissolve', name: 'Pixel Dissolve' },
  { id: 'zoomin', name: 'Zoom In' },
];
export const TRANSITION_IDS = TRANSITIONS.map((t) => t.id);
export const DEFAULT_TRANSITION_DURATION = 1;

// ---- Tracks ----
// Video tracks are listed top to bottom; the lowest one is the main track (it carries
// transitions), the ones above it are overlays composited over it (picture in picture).
export const videoTracks = (project) => project.tracks.filter((t) => t.kind === 'video');
export const mainVideoTrack = (project) => videoTracks(project).at(-1);
// Overlay tracks from bottom to top, i.e. in compositing order.
export const overlayTracks = (project) => videoTracks(project).slice(0, -1).reverse();

// A clip's transition plays over [clip.start, clip.start + duration] while the previous clip
// keeps running underneath (frozen on its last frame if the source runs out). Without a clip
// ending exactly where this one starts, it transitions in from black (prev is null).
export function transitionInto(track, clip) {
  const tr = clip.transition;
  if (!tr || !TRANSITION_IDS.includes(tr.type)) return null;
  const prev =
    track.clips.find((c) => c !== clip && Math.abs(clipEnd(c) - clip.start) < EPS) || null;
  const duration = Math.min(tr.duration, clipDur(clip));
  if (duration < 0.05) return null;
  return { prev, type: tr.type, duration };
}

export function transitionOutOf(track, clip) {
  const next = track.clips.find((c) => c !== clip && Math.abs(c.start - clipEnd(clip)) < EPS);
  const tr = next && transitionInto(track, next);
  return tr?.prev ? { next, ...tr } : null;
}

// Fades to black are skipped where a transition already handles the cut.
export function effectiveFades(track, clip) {
  return {
    fadeIn: transitionInto(track, clip) ? 0 : clip.fadeIn || 0,
    fadeOut: transitionOutOf(track, clip) ? 0 : clip.fadeOut || 0,
  };
}

export function fadeFactorAt(fades, dur, local) {
  let f = 1;
  if (fades.fadeIn > 0) f = Math.min(f, local / fades.fadeIn);
  if (fades.fadeOut > 0) f = Math.min(f, (dur - local) / fades.fadeOut);
  return Math.max(0, Math.min(1, f));
}

// ---- Keyframes ----
// clip.transform holds static values; clip.keyframes[prop] = [{ t, v, ease }] overrides them.
// Keyframe `t` is a source timestamp so keyframes stay attached to the footage when the clip
// is trimmed, split or sped up.
export const TRANSFORM_PROPS = {
  x: { def: 0.5, min: -0.5, max: 1.5, step: 0.005, label: 'Position X' },
  y: { def: 0.5, min: -0.5, max: 1.5, step: 0.005, label: 'Position Y' },
  scale: { def: 1, min: 0.1, max: 4, step: 0.01, label: 'Scale' },
  rotation: { def: 0, min: -360, max: 360, step: 1, label: 'Rotation' },
  opacity: { def: 1, min: 0, max: 1, step: 0.01, label: 'Opacity' },
};

export const smoothstep01 = (u) => u * u * (3 - 2 * u);

// Keyframes of `prop` as [{ local, v, ease }] in clip-local timeline seconds, sorted.
export function localKeyframes(clip, prop) {
  const kfs = clip.keyframes?.[prop];
  if (!kfs?.length) return null;
  return kfs
    .map((k) => ({ local: localTimeOf(clip, k.t), v: k.v, ease: k.ease || 'linear' }))
    .sort((a, b) => a.local - b.local);
}

export function staticValue(clip, prop) {
  return clip.transform?.[prop] ?? TRANSFORM_PROPS[prop].def;
}

export function propAt(clip, prop, local) {
  const kfs = localKeyframes(clip, prop);
  if (!kfs) return staticValue(clip, prop);
  if (local <= kfs[0].local) return kfs[0].v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (local <= b.local) {
      let u = (local - a.local) / Math.max(EPS, b.local - a.local);
      if (a.ease === 'ease') u = smoothstep01(u);
      return a.v + (b.v - a.v) * u;
    }
  }
  return kfs[kfs.length - 1].v;
}

export function isAnimated(clip, prop) {
  return !!clip.keyframes?.[prop]?.length;
}

// ---- In / Out animations ----
// Each animation moves a property from `from` to its resting value over the animation's
// duration. Position and rotation offsets add to the clip's transform, scale and opacity
// multiply it. Out animations play the same motion in reverse, leaving in the opposite
// direction they would enter from.
export const ANIMATIONS = [
  { id: 'fade', name: 'Fade', props: { opacity: 0 }, text: true },
  { id: 'zoom-in', name: 'Zoom In', props: { scale: 0.4, opacity: 0 } },
  { id: 'zoom-out', name: 'Zoom Out', props: { scale: 1.8, opacity: 0 } },
  { id: 'slide-left', name: 'Slide Left', props: { x: 1 }, text: true },
  { id: 'slide-right', name: 'Slide Right', props: { x: -1 }, text: true },
  { id: 'slide-up', name: 'Slide Up', props: { y: 1 }, text: true },
  { id: 'slide-down', name: 'Slide Down', props: { y: -1 }, text: true },
  { id: 'rise', name: 'Rise', props: { y: 0.12, opacity: 0 }, text: true },
  { id: 'drop', name: 'Drop', props: { y: -0.12, opacity: 0 }, text: true },
  { id: 'pop', name: 'Pop', props: { scale: 0 }, ease: 'back' },
  { id: 'spin', name: 'Spin', props: { rotation: -180, scale: 0 } },
  { id: 'swing', name: 'Swing', props: { rotation: 20, opacity: 0 }, ease: 'back' },
  { id: 'flip-zoom', name: 'Whirl', props: { rotation: 90, scale: 1.6, opacity: 0 } },
];
export const DEFAULT_ANIMATION_DURATION = 0.6;
const ANIM_BY_ID = Object.fromEntries(ANIMATIONS.map((a) => [a.id, a]));
const ADDITIVE = new Set(['x', 'y', 'rotation']);
export const REST = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 };

const easeOutCubic = (u) => 1 - Math.pow(1 - u, 3);
const easeOutBack = (u) => 1 + 2.70158 * Math.pow(u - 1, 3) + 1.70158 * Math.pow(u - 1, 2);
export const animEase = (anim) => (anim.ease === 'back' ? easeOutBack : easeOutCubic);

// Active animations of a clip as [{ anim, duration, dir }] with durations fitted to the clip.
export function clipAnimations(clip) {
  const dur = clipDur(clip);
  const out = [];
  for (const dir of ['in', 'out']) {
    const a = dir === 'in' ? clip.animIn : clip.animOut;
    const anim = a && ANIM_BY_ID[a.type];
    if (!anim) continue;
    const duration = Math.min(a.duration ?? DEFAULT_ANIMATION_DURATION, dur);
    if (duration > 0.01) out.push({ anim, duration, dir });
  }
  return out;
}

// Starting value of `prop` for an animation; out animations leave the opposite way.
export function animFrom(anim, prop, dir) {
  const v = anim.props[prop];
  if (v === undefined) return undefined;
  return dir === 'out' && (prop === 'x' || prop === 'y') ? -v : v;
}

// Offset/factor contributed by the clip's animations to `prop` at clip-local time `local`.
export function animValue(clip, prop, local) {
  const dur = clipDur(clip);
  let v = REST[prop];
  for (const { anim, duration, dir } of clipAnimations(clip)) {
    const from = animFrom(anim, prop, dir);
    if (from === undefined) continue;
    const u = Math.max(0, Math.min(1, dir === 'in' ? local / duration : (dur - local) / duration));
    const val = from + (REST[prop] - from) * animEase(anim)(u);
    v = ADDITIVE.has(prop) ? v + val : v * val;
  }
  return v;
}

export const isAdditive = (prop) => ADDITIVE.has(prop);

// Final transform of a visual clip: keyframes/static values combined with animations.
export function layerProps(clip, local) {
  return {
    x: propAt(clip, 'x', local) + animValue(clip, 'x', local),
    y: propAt(clip, 'y', local) + animValue(clip, 'y', local),
    scale: propAt(clip, 'scale', local) * animValue(clip, 'scale', local),
    rotation: propAt(clip, 'rotation', local) + animValue(clip, 'rotation', local),
    opacity: Math.max(
      0,
      Math.min(1, propAt(clip, 'opacity', local) * animValue(clip, 'opacity', local)),
    ),
  };
}

const animates = (clip, prop) =>
  clipAnimations(clip).some(({ anim }) => anim.props[prop] !== undefined);

export function hasTransform(clip) {
  return ['x', 'y', 'scale', 'rotation'].some(
    (p) =>
      isAnimated(clip, p) || staticValue(clip, p) !== TRANSFORM_PROPS[p].def || animates(clip, p),
  );
}

export function hasOpacity(clip) {
  return (
    isAnimated(clip, 'opacity') || staticValue(clip, 'opacity') !== 1 || animates(clip, 'opacity')
  );
}

// ---- Audio ----
export const DEFAULT_AUDIO = { bass: 0, mid: 0, treble: 0, denoise: false, highpass: false };
export const clipAudio = (c) => ({ ...DEFAULT_AUDIO, ...c.audio });
