// What the preview should show and play at timeline time `t`.
import {
  activeClip,
  clipAudio,
  clipDur,
  clipEnd,
  clipSpeed,
  effectiveFades,
  fadeFactorAt,
  layerProps,
  mainVideoTrack,
  mediaUrl,
  overlayTracks,
  sourceTime,
  transitionInto,
} from '../project.js';
import { clipGrade } from '../../shared/grade.mjs';

const PRELOAD_AHEAD = 2;

// Preview plays the proxy when Chromium can't decode the original.
export const playbackUrl = (media) => mediaUrl(media.proxy || media.path);

function visualLayer(project, track, clip, t, isMain) {
  const media = project.media[clip.mediaId];
  if (!media || media.missing) return null;
  const local = t - clip.start;
  const dur = clipDur(clip);
  let src = sourceTime(clip, t);
  let frozen = false;
  if (media.kind === 'video' && src > media.duration - 0.05) {
    src = Math.max(0, media.duration - 0.05);
    frozen = true;
  }
  const fades = isMain
    ? effectiveFades(track, clip)
    : { fadeIn: clip.fadeIn, fadeOut: clip.fadeOut };
  const fade = local < dur ? fadeFactorAt(fades, dur, local) : 1;
  const props = layerProps(clip, Math.min(local, dur));
  return {
    clip,
    track,
    media,
    src,
    frozen: frozen || local >= dur,
    ...props,
    opacity: props.opacity * fade,
    grade: clipGrade(clip),
  };
}

function audioParams(clip, t, enabled) {
  if (!enabled || clip.muted) return null;
  const fx = clipAudio(clip);
  const f = fadeFactorAt(
    { fadeIn: clip.fadeIn, fadeOut: clip.fadeOut },
    clipDur(clip),
    t - clip.start,
  );
  return {
    gain: clip.volume * f,
    bass: fx.bass,
    mid: fx.mid,
    treble: fx.treble,
    highpass: fx.highpass,
  };
}

function nextClip(track, t) {
  return track.clips
    .filter((c) => c.start > t && c.start - t <= PRELOAD_AHEAD)
    .sort((a, b) => a.start - b.start)[0];
}

export function buildScene(project, t) {
  const main = mainVideoTrack(project);
  const scene = {
    current: null,
    prev: null,
    transition: null,
    overlays: [],
    videoItems: [],
    audioItems: [],
  };

  if (!main.hidden) {
    const cur = activeClip(main, t);
    if (cur) {
      scene.current = visualLayer(project, main, cur, t, true);
      const tr = transitionInto(main, cur);
      if (tr && t < cur.start + tr.duration) {
        scene.prev = tr.prev && visualLayer(project, main, tr.prev, t, true);
        scene.transition = {
          type: tr.type,
          progress: Math.max(0, Math.min(1, 1 - (t - cur.start) / tr.duration)),
        };
      }
    }
  }
  for (const track of overlayTracks(project)) {
    if (track.hidden) continue;
    const clip = activeClip(track, t);
    const layer = clip && visualLayer(project, track, clip, t, false);
    if (layer) scene.overlays.push(layer);
  }

  const visual = [scene.current, scene.prev, ...scene.overlays].filter(Boolean);
  for (const layer of visual) {
    if (layer.media.kind !== 'video') continue;
    const playsAudio =
      layer !== scene.prev &&
      layer.media.hasAudio &&
      !layer.clip.audioDetached &&
      !layer.track.muted;
    scene.videoItems.push({
      key: layer.clip.id,
      url: playbackUrl(layer.media),
      src: layer.src,
      rate: clipSpeed(layer.clip),
      frozen: layer.frozen,
      audio: audioParams(layer.clip, t, playsAudio),
      layer,
    });
  }
  for (const track of [main, ...overlayTracks(project)]) {
    if (track.hidden) continue;
    const upcoming = nextClip(track, t);
    const media = upcoming && project.media[upcoming.mediaId];
    if (media?.kind === 'video' && !media.missing) {
      scene.videoItems.push({
        key: upcoming.id,
        url: playbackUrl(media),
        src: upcoming.in,
        preload: true,
      });
    }
  }

  for (const atrack of project.tracks.filter((k) => k.kind === 'audio' && !k.muted)) {
    const clip = activeClip(atrack, t);
    const media = clip && project.media[clip.mediaId];
    if (media && !media.missing) {
      scene.audioItems.push({
        key: clip.id,
        url: playbackUrl(media),
        src: sourceTime(clip, t),
        rate: clipSpeed(clip),
        frozen: t >= clipEnd(clip),
        audio: audioParams(clip, t, true),
      });
    }
    const up = nextClip(atrack, t);
    const upMedia = up && project.media[up.mediaId];
    if (upMedia && !upMedia.missing) {
      scene.audioItems.push({ key: up.id, url: playbackUrl(upMedia), src: up.in, preload: true });
    }
  }
  return scene;
}
