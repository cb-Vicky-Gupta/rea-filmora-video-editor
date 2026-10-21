// Timeline rules shared by the renderer (preview) and the main process (export), so both
// agree on timing, keyframes and transitions.
//
// Every clip uses { start, in, out, speed }: `start` is its position on the timeline,
// `in`/`out` are source timestamps and `(out - in) / speed` is its length on the timeline.

export const EPS = 0.001;
export const MIN_CLIP = 0.1;

export const clipSpeed = (c) => c.speed || 1;
export const clipDur = (c) => (c.out - c.in) / clipSpeed(c);
export const clipEnd = (c) => c.start + clipDur(c);
// Source timestamp shown at timeline time `t` (may run past `out` during a transition).
export const sourceTime = (c, t) => c.in + (t - c.start) * clipSpeed(c);

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
  const prev = track.clips.find((c) => c !== clip && Math.abs(clipEnd(c) - clip.start) < EPS) || null;
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
    .map((k) => ({ local: (k.t - clip.in) / clipSpeed(clip), v: k.v, ease: k.ease || 'linear' }))
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
    opacity: Math.max(0, Math.min(1, propAt(clip, 'opacity', local) * animValue(clip, 'opacity', local))),
  };
}

const animates = (clip, prop) => clipAnimations(clip).some(({ anim }) => anim.props[prop] !== undefined);

export function hasTransform(clip) {
  return ['x', 'y', 'scale', 'rotation'].some(
    (p) => isAnimated(clip, p) || staticValue(clip, p) !== TRANSFORM_PROPS[p].def || animates(clip, p)
  );
}

export function hasOpacity(clip) {
  return isAnimated(clip, 'opacity') || staticValue(clip, 'opacity') !== 1 || animates(clip, 'opacity');
}

// ---- Audio ----
export const DEFAULT_AUDIO = { bass: 0, mid: 0, treble: 0, denoise: false, highpass: false };
export const clipAudio = (c) => ({ ...DEFAULT_AUDIO, ...c.audio });
