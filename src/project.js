// Timeline model, reducer and undo history. Timing rules live in shared/model.mjs.
import {
  EPS,
  MIN_CLIP,
  clipDur,
  clipEnd,
  hasRamp,
  mainVideoTrack,
  sourceTime,
  splitRamp,
} from '../shared/model.mjs';

export * from '../shared/model.mjs';

export const uid = () => crypto.randomUUID();
// Desktop serves local files over the media:// protocol; Android hands out object URLs.
export const mediaUrl = (p) =>
  window.api?.mediaUrl ? window.api.mediaUrl(p) : 'media://file/' + encodeURIComponent(p);
export const isBounded = (media) => !!media && media.kind !== 'image';
export const baseName = (p) => p.split(/[\\/]/).pop();

export function newProject() {
  return {
    version: 2,
    settings: { width: 1920, height: 1080, fps: 30, magnet: true },
    media: {},
    tracks: [
      { id: 'v1', kind: 'video', name: 'Video 1', clips: [] },
      { id: 't1', kind: 'text', name: 'Titles', clips: [] },
      { id: 'a1', kind: 'audio', name: 'Music', clips: [] },
      { id: 'a2', kind: 'audio', name: 'Voiceover', clips: [] },
    ],
  };
}

export function findClip(project, clipId) {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function activeClip(track, t) {
  return track?.clips.find((c) => t >= c.start && t < clipEnd(c));
}

// Nearest start >= 0 to `desired` where a clip of length `dur` fits without overlapping `others`.
export function findFreeStart(others, dur, desired) {
  const sorted = [...others].sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 0;
  for (const c of sorted) {
    gaps.push([cursor, c.start]);
    cursor = Math.max(cursor, clipEnd(c));
  }
  gaps.push([cursor, Infinity]);

  let best = cursor;
  let bestDist = Infinity;
  for (const [a, b] of gaps) {
    if (b - a < dur - EPS) continue;
    const candidate = Math.min(Math.max(desired, a), b - dur);
    const dist = Math.abs(candidate - desired);
    if (dist < bestDist) {
      best = candidate;
      bestDist = dist;
    }
  }
  return Math.max(0, best);
}

const fits = (track, start, dur) =>
  track.clips.every((c) => clipEnd(c) <= start + EPS || c.start >= start + dur - EPS);

export function trackAccepts(track, media) {
  if (!media) return false;
  if (track.kind === 'video') return media.kind === 'video' || media.kind === 'image';
  if (track.kind === 'audio')
    return media.kind === 'audio' || (media.kind === 'video' && media.hasAudio);
  return false;
}

export function trackKindFor(media) {
  return media.kind === 'audio' ? 'audio' : 'video';
}

function mapTracks(project, fn) {
  return { ...project, tracks: project.tracks.map(fn) };
}

function mapClip(project, clipId, fn) {
  return mapTracks(project, (t) => ({
    ...t,
    clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)),
  }));
}

// Tracks that can't be removed: the main video track and the titles track.
export const isPermanentTrack = (project, track) =>
  track.kind === 'text' || track === mainVideoTrack(project);

function newVideoTrack(project) {
  const count = project.tracks.filter((t) => t.kind === 'video').length;
  return { id: uid(), kind: 'video', name: `Video ${count + 1}`, clips: [] };
}

function newAudioTrack(project) {
  const count = project.tracks.filter((t) => t.kind === 'audio').length;
  return { id: uid(), kind: 'audio', name: `Audio ${count + 1}`, clips: [] };
}

function projectReducer(project, action) {
  switch (action.type) {
    case 'ADD_MEDIA': {
      const media = { ...project.media };
      for (const m of action.items) media[m.id] = m;
      return { ...project, media };
    }
    case 'REMOVE_MEDIA': {
      const media = { ...project.media };
      delete media[action.mediaId];
      return {
        ...mapTracks(project, (t) => ({
          ...t,
          clips: t.clips.filter((c) => c.mediaId !== action.mediaId),
        })),
        media,
      };
    }
    case 'ADD_CLIP': {
      const media = project.media[action.mediaId];
      if (!media) return project;
      const track =
        project.tracks.find((t) => t.id === action.trackId && trackAccepts(t, media)) ||
        (trackKindFor(media) === 'video'
          ? mainVideoTrack(project)
          : project.tracks.find((t) => t.kind === 'audio'));
      const dur = media.duration;
      const desired = action.start ?? track.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
      const clip = {
        id: action.clipId || uid(),
        mediaId: media.id,
        start: findFreeStart(track.clips, dur, desired),
        in: 0,
        out: dur,
        speed: 1,
        volume: 1,
        muted: false,
        fadeIn: 0,
        fadeOut: 0,
      };
      return mapTracks(project, (t) =>
        t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t,
      );
    }
    case 'ADD_TITLE': {
      const track = project.tracks.find((t) => t.kind === 'text');
      const clip = {
        id: action.clipId || uid(),
        start: findFreeStart(track.clips, action.preset?.out ?? 3, action.start),
        in: 0,
        out: 3,
        text: 'Your Title',
        fontSize: 96,
        color: '#ffffff',
        x: 0.5,
        y: 0.5,
        box: false,
        ...action.preset,
      };
      return mapTracks(project, (t) =>
        t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t,
      );
    }
    case 'ADD_AUDIO_TRACK':
      return { ...project, tracks: [...project.tracks, newAudioTrack(project)] };
    case 'ADD_VIDEO_TRACK':
      // New video tracks go on top, above existing ones.
      return { ...project, tracks: [newVideoTrack(project), ...project.tracks] };
    case 'REMOVE_TRACK': {
      const track = project.tracks.find((t) => t.id === action.trackId);
      if (!track || isPermanentTrack(project, track)) return project;
      return { ...project, tracks: project.tracks.filter((t) => t !== track) };
    }
    case 'UPDATE_TRACK':
      return mapTracks(project, (t) => (t.id === action.trackId ? { ...t, ...action.patch } : t));
    case 'MOVE_CLIP': {
      const found = findClip(project, action.clipId);
      const target = project.tracks.find((t) => t.id === action.trackId);
      if (!found || !target) return project;
      const moved = { ...found.clip, ...action.patch };
      return mapTracks(project, (t) => {
        const clips = t.clips.filter((c) => c.id !== moved.id);
        return t.id === target.id ? { ...t, clips: [...clips, moved] } : { ...t, clips };
      });
    }
    case 'SET_ANIMATION':
      return mapClip(project, action.clipId, (c) => ({
        ...c,
        [action.dir === 'in' ? 'animIn' : 'animOut']: action.animation || undefined,
      }));
    case 'UPDATE_CLIP':
      return mapClip(project, action.clipId, (c) => ({ ...c, ...action.patch }));
    case 'DELETE_CLIP': {
      const found = findClip(project, action.clipId);
      if (!found) return project;
      // With the magnet on, later clips on the same track slide left to fill the hole
      // (the main track is compacted afterwards anyway).
      const end = clipEnd(found.clip);
      const shift = project.settings.magnet ? clipDur(found.clip) : 0;
      return mapTracks(project, (t) =>
        t !== found.track
          ? t
          : {
              ...t,
              clips: t.clips
                .filter((c) => c.id !== action.clipId)
                .map((c) =>
                  shift && c.start >= end - EPS ? { ...c, start: Math.max(0, c.start - shift) } : c,
                ),
            },
      );
    }
    case 'SPLIT': {
      const found = findClip(project, action.clipId);
      if (!found) return project;
      const { clip } = found;
      const offset = action.time - clip.start;
      if (offset < MIN_CLIP || clipDur(clip) - offset < MIN_CLIP) return project;
      const cut = sourceTime(clip, action.time);
      const left = { ...clip, out: cut, fadeOut: 0 };
      const right = {
        ...clip,
        id: action.newId,
        start: action.time,
        in: cut,
        fadeIn: 0,
        transition: undefined,
      };
      // Each half keeps its part of the speed curve.
      if (hasRamp(clip))
        [left.ramp, right.ramp] = splitRamp(clip.ramp, (cut - clip.in) / (clip.out - clip.in));
      return mapTracks(project, (t) => ({
        ...t,
        clips: t.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])),
      }));
    }
    case 'SET_SPEED':
    case 'SET_RAMP': {
      // Changing speed changes the clip's length; later clips on the track ripple to follow.
      // A constant speed replaces any ramp; a null ramp goes back to the constant speed.
      const found = findClip(project, action.clipId);
      if (!found) return project;
      const { track, clip } = found;
      const oldEnd = clipEnd(clip);
      const updated =
        action.type === 'SET_SPEED'
          ? { ...clip, speed: action.speed, ramp: undefined }
          : { ...clip, ramp: action.ramp || undefined };
      const delta = clipEnd(updated) - oldEnd;
      return mapTracks(project, (t) =>
        t.id !== track.id
          ? t
          : {
              ...t,
              clips: t.clips.map((c) => {
                if (c.id === clip.id) return updated;
                if (c.start >= oldEnd - EPS) return { ...c, start: Math.max(0, c.start + delta) };
                return c;
              }),
            },
      );
    }
    case 'APPLY_GRADE_ALL':
      return mapTracks(project, (t) =>
        t.kind === 'video'
          ? { ...t, clips: t.clips.map((c) => ({ ...c, grade: action.grade })) }
          : t,
      );
    case 'SET_TRANSITION':
      return mapClip(project, action.clipId, (c) => ({
        ...c,
        transition: action.transition || undefined,
      }));
    case 'SET_KEYFRAME': {
      // Replaces a keyframe within half a frame of `t`, otherwise inserts one.
      const tol = 0.5 / project.settings.fps;
      return mapClip(project, action.clipId, (c) => {
        const list = (c.keyframes?.[action.prop] || []).filter(
          (k) => Math.abs(k.t - action.t) > tol,
        );
        const prevEase = c.keyframes?.[action.prop]?.find(
          (k) => Math.abs(k.t - action.t) <= tol,
        )?.ease;
        list.push({ t: action.t, v: action.v, ease: action.ease || prevEase || 'linear' });
        list.sort((a, b) => a.t - b.t);
        return { ...c, keyframes: { ...c.keyframes, [action.prop]: list } };
      });
    }
    case 'REMOVE_KEYFRAME': {
      const tol = 0.5 / project.settings.fps;
      return mapClip(project, action.clipId, (c) => {
        const list = (c.keyframes?.[action.prop] || []).filter(
          (k) => Math.abs(k.t - action.t) > tol,
        );
        return { ...c, keyframes: { ...c.keyframes, [action.prop]: list } };
      });
    }
    case 'CLEAR_KEYFRAMES':
      // Keeps the value at the playhead as the new static value.
      return mapClip(project, action.clipId, (c) => ({
        ...c,
        transform: { ...c.transform, [action.prop]: action.value },
        keyframes: { ...c.keyframes, [action.prop]: [] },
      }));
    case 'DETACH_AUDIO': {
      const found = findClip(project, action.clipId);
      const media = found && project.media[found.clip.mediaId];
      if (!media?.hasAudio || found.track.kind !== 'video' || found.clip.audioDetached)
        return project;
      const { clip } = found;
      const audioClip = {
        id: action.newId,
        mediaId: clip.mediaId,
        start: clip.start,
        in: clip.in,
        out: clip.out,
        speed: clip.speed || 1,
        ramp: clip.ramp,
        volume: clip.volume,
        muted: clip.muted,
        fadeIn: clip.fadeIn,
        fadeOut: clip.fadeOut,
        audio: clip.audio,
      };
      let next = mapClip(project, clip.id, (c) => ({ ...c, audioDetached: true }));
      let target = next.tracks.find(
        (t) => t.kind === 'audio' && fits(t, clip.start, clipDur(clip)),
      );
      if (!target) {
        target = newAudioTrack(next);
        next = { ...next, tracks: [...next.tracks, target] };
      }
      return mapTracks(next, (t) =>
        t.id === target.id ? { ...t, clips: [...t.clips, audioClip] } : t,
      );
    }
    case 'SET_SETTINGS':
      return { ...project, settings: { ...project.settings, ...action.patch } };
    default:
      return project;
  }
}

// Magnetic main track: clips are packed from 0 with no gaps, in order of their midpoints
// (so a clip dropped over another one is inserted before or after it).
function compactMainTrack(project) {
  const main = mainVideoTrack(project);
  const sorted = [...main.clips].sort(
    (a, b) => a.start + clipDur(a) / 2 - (b.start + clipDur(b) / 2),
  );
  let t = 0;
  let changed = false;
  const clips = sorted.map((c) => {
    const placed = Math.abs(c.start - t) < EPS ? c : { ...c, start: t };
    if (placed !== c) changed = true;
    t += clipDur(placed);
    return placed;
  });
  if (!changed) return project;
  return {
    ...project,
    tracks: project.tracks.map((tr) => (tr === main ? { ...main, clips } : tr)),
  };
}

// Undo/redo wrapper around the project reducer.
export function historyReducer(state, action) {
  switch (action.type) {
    case 'UNDO':
      if (!state.past.length) return state;
      return {
        past: state.past.slice(0, -1),
        present: state.past[state.past.length - 1],
        future: [state.present, ...state.future],
      };
    case 'REDO':
      if (!state.future.length) return state;
      return {
        past: [...state.past, state.present],
        present: state.future[0],
        future: state.future.slice(1),
      };
    case 'LOAD_PROJECT':
      return { past: [], present: action.project, future: [] };
    default: {
      let next = projectReducer(state.present, action);
      if (next.settings.magnet) next = compactMainTrack(next);
      if (next === state.present) return state;
      return { past: [...state.past.slice(-99), state.present], present: next, future: [] };
    }
  }
}

export function formatTime(t, withFrac = true) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return withFrac ? `${base}.${String(Math.floor((s % 1) * 100)).padStart(2, '0')}` : base;
}
