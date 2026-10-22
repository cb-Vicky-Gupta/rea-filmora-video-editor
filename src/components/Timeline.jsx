import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './icons.jsx';
import { LOOK_DRAG_TYPE, MEDIA_DRAG_TYPE, TRANSITION_DRAG_TYPE } from './MediaBin.jsx';
import { LOOKS } from '../../shared/grade.mjs';
import {
  DEFAULT_TRANSITION_DURATION,
  EPS,
  MIN_CLIP,
  TRANSITIONS,
  clipAnimations,
  clipDur,
  clipEnd,
  clipSpeed,
  findFreeStart,
  formatTime,
  hasRamp,
  isBounded,
  isPermanentTrack,
  localKeyframes,
  mainVideoTrack,
  mediaUrl,
  trackAccepts,
  transitionInto,
  uid,
} from '../project.js';

const SNAP_PX = 8;
// Touch screens get wider trim handles and a narrower track header.
const coarse = () => window.matchMedia('(pointer: coarse)').matches;
const narrow = () => window.matchMedia('(max-width: 820px)').matches;
const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
const LONG_PRESS_MS = 350;
const MIN_ZOOM = 10;
const MAX_ZOOM = 300;

// Applies a move/trim drag to a clip, respecting neighbours and source length.
// `magnetic`: the clip is on the magnetic main track, where it may overlap neighbours while
// dragging; the reducer then packs the track (inserting or pushing clips).
function dragGeometry(drag, dx, zoom, others, media, snapPoints, magnetic) {
  const { orig, mode } = drag;
  const d = dx / zoom;
  const dur = clipDur(orig);
  const speed = clipSpeed(orig);
  const snapTol = SNAP_PX / zoom;
  const snap = (t) => {
    let best = null;
    for (const p of snapPoints)
      if (Math.abs(p - t) < snapTol && (best === null || Math.abs(p - t) < Math.abs(best - t)))
        best = p;
    return best;
  };

  if (mode === 'move') {
    let start = orig.start + d;
    const s1 = snap(start);
    const s2 = snap(start + dur);
    if (s1 !== null) start = s1;
    else if (s2 !== null) start = s2 - dur;
    if (magnetic) return { ...orig, start: Math.max(0, start) };
    return { ...orig, start: findFreeStart(others, dur, Math.max(0, start)) };
  }

  const prevEnd = others
    .filter((c) => c.start < orig.start)
    .reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const nextStart = magnetic
    ? Infinity
    : others
        .filter((c) => c.start >= orig.start + dur - EPS)
        .reduce((m, c) => Math.min(m, c.start), Infinity);

  if (mode === 'right') {
    let end = orig.start + dur + d;
    const s = snap(end);
    if (s !== null) end = s;
    end = Math.min(end, nextStart);
    let out = orig.in + (end - orig.start) * speed;
    if (isBounded(media)) out = Math.min(out, media.duration);
    return { ...orig, out: Math.max(orig.in + MIN_CLIP * speed, out) };
  }

  // left trim
  let start = orig.start + d;
  const s = snap(start);
  if (s !== null) start = s;
  start = Math.max(start, prevEnd, 0);
  start = Math.min(start, orig.start + dur - MIN_CLIP);
  let shift = start - orig.start;
  if (isBounded(media)) shift = Math.max(shift, -orig.in / speed);
  const next = { ...orig, start: orig.start + shift, in: orig.in + shift * speed };
  // Images and titles have no source offset; keep in at 0.
  return isBounded(media) ? next : { ...next, out: next.out - next.in, in: 0 };
}

function Ruler({ width, zoom, offset = 0 }) {
  const step = TICK_STEPS.find((s) => s * zoom >= 70) || 600;
  const ticks = [];
  for (let t = 0; t * zoom < width; t += step) ticks.push(t);
  return (
    <div className="ruler" style={{ width, marginLeft: offset }}>
      {ticks.map((t) => (
        <div key={t} className="tick" style={{ left: t * zoom }}>
          <span>{formatTime(t, step < 1)}</span>
        </div>
      ))}
    </div>
  );
}

function TrackHeader({ project, track, dispatch }) {
  const isMain = track === mainVideoTrack(project);
  const toggle = (key) =>
    dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { [key]: !track[key] } });
  return (
    <div className="track-label sticky">
      <span className="track-name" title={isMain ? 'Main video track (transitions)' : track.name}>
        {track.name}
        {isMain && <span className="badge">main</span>}
      </span>
      <span className="track-tools">
        {track.kind !== 'audio' && (
          <button
            className={`icon ${track.hidden ? 'off' : ''}`}
            title={track.hidden ? 'Show track' : 'Hide track'}
            onClick={() => toggle('hidden')}
          >
            {track.hidden ? '◌' : '◉'}
          </button>
        )}
        {track.kind !== 'text' && (
          <button
            className={`icon ${track.muted ? 'off' : ''}`}
            title={track.muted ? 'Unmute track' : 'Mute track'}
            onClick={() => toggle('muted')}
          >
            {track.muted ? '🔇' : '🔊'}
          </button>
        )}
        {!isPermanentTrack(project, track) && (
          <button
            className="icon danger-icon"
            title="Delete track and its clips"
            onClick={() => dispatch({ type: 'REMOVE_TRACK', trackId: track.id })}
          >
            ✕
          </button>
        )}
      </span>
    </div>
  );
}

// Touch layout: a narrow sticky column with the track's mute (or, for titles, hide) toggle.
function CompactTrackHeader({ track, dispatch }) {
  const key = track.kind === 'text' ? 'hidden' : 'muted';
  const off = !!track[key];
  const icon = key === 'hidden' ? (off ? 'eyeOff' : 'eye') : off ? 'mute' : 'volume';
  return (
    <div className="track-label sticky compact">
      <button
        className={`track-btn ${off ? 'off' : ''}`}
        title={`${track.name}: ${key === 'hidden' ? (off ? 'show' : 'hide') : off ? 'unmute' : 'mute'}`}
        onClick={() =>
          dispatch({ type: 'UPDATE_TRACK', trackId: track.id, patch: { [key]: !off } })
        }
      >
        <Icon name={icon} size={16} />
      </button>
    </div>
  );
}

export default function Timeline({
  project,
  time,
  setTime,
  playing,
  duration,
  selectedId,
  setSelectedId,
  selectedTransition,
  setSelectedTransition,
  dispatch,
  zoom,
  setZoom,
  onSplit,
  onDelete,
  onOpenTab,
  // Touch layout: fixed centre playhead, the timeline scrolls under it.
  mobile = false,
  onScrub,
  onAddMedia,
}) {
  const scrollRef = useRef(null);
  const rowRefs = useRef(new Map());
  const LABEL_WIDTH = mobile ? 40 : narrow() ? 96 : 150;
  const HANDLE_PX = mobile ? 0 : coarse() ? 16 : 7;
  const timeRef = useRef(time);
  timeRef.current = time;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pinchRef = useRef(null);
  const pressRef = useRef(null);
  const tapRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [viewWidth, setViewWidth] = useState(800);

  useEffect(() => {
    const el = scrollRef.current;
    const ro = new ResizeObserver(([e]) => setViewWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // x of time 0 inside the scrolled content. On touch, half a screen of lead-in lets time 0
  // reach the centre playhead.
  const OFFSET = mobile ? Math.round(viewWidth / 2) : LABEL_WIDTH;
  const contentWidth = mobile
    ? duration * zoom + Math.round(viewWidth / 2)
    : Math.max(viewWidth, (duration + 20) * zoom);

  const timeAt = (clientX) => {
    const el = scrollRef.current;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - OFFSET;
    return Math.max(0, x / zoom);
  };

  // Touch layout: the scroll position *is* the playhead position.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!mobile || !el) return;
    const target = time * zoom;
    if (Math.abs(el.scrollLeft - target) > 1) el.scrollLeft = target;
  }, [mobile, time, zoom, viewWidth, contentWidth]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!mobile || dragRef.current || pinchRef.current) return;
    if (Math.abs(el.scrollLeft - timeRef.current * zoomRef.current) <= 1) return;
    onScrub?.();
    setTime(Math.min(duration, el.scrollLeft / zoomRef.current));
  };

  // Two-finger pinch zooms the timeline around the playhead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!mobile) return;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const start = (e) => {
      if (e.touches.length === 2) pinchRef.current = { d: dist(e.touches), zoom: zoomRef.current };
    };
    const move = (e) => {
      const p = pinchRef.current;
      if (!p || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const z = (p.zoom * dist(e.touches)) / p.d;
      setZoom(Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))));
    };
    const end = (e) => {
      if (e.touches.length < 2) pinchRef.current = null;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [mobile, setZoom]);

  // Keep the playhead in view during playback.
  useEffect(() => {
    const el = scrollRef.current;
    if (mobile || !playing || !el) return;
    const x = time * zoom;
    const visible = el.clientWidth - LABEL_WIDTH;
    if (x > el.scrollLeft + visible - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
  }, [mobile, LABEL_WIDTH, time, playing, zoom]);

  // Scrubbing the playhead.
  useEffect(() => {
    if (!scrubbing) return;
    const move = (e) => setTime(timeAt(e.clientX));
    const up = () => setScrubbing(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  });

  // Moving / trimming clips. Moves can also carry a clip to another track of the same kind.
  useEffect(() => {
    if (!drag) return;
    const media = project.media[drag.orig.mediaId];
    const snapPoints = [
      0,
      time,
      ...project.tracks.flatMap((t) =>
        t.clips.filter((c) => c.id !== drag.clipId).flatMap((c) => [c.start, clipEnd(c)]),
      ),
    ];
    const source = project.tracks.find((t) => t.id === drag.trackId);

    const trackUnder = (clientY) => {
      for (const [id, el] of rowRefs.current) {
        const r = el.getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) {
          const t = project.tracks.find((k) => k.id === id);
          const ok =
            source.kind === 'text'
              ? t === source
              : t?.kind === source.kind && trackAccepts(t, media);
          return ok ? t : null;
        }
      }
      return null;
    };

    const move = (e) => {
      const d = dragRef.current;
      const target =
        d.mode === 'move'
          ? trackUnder(e.clientY) || project.tracks.find((t) => t.id === d.trackId)
          : source;
      const others = target.clips.filter((c) => c.id !== d.clipId);
      const magnetic = !!project.settings.magnet && target === mainVideoTrack(project);
      const geo = dragGeometry(d, e.clientX - d.startX, zoom, others, media, snapPoints, magnetic);
      const moved = d.moved || Math.abs(e.clientX - d.startX) > 2 || target !== source;
      dragRef.current = { ...d, trackId: target.id, current: geo, moved };
      setDrag(dragRef.current);
    };
    const up = () => {
      const d = dragRef.current;
      if (d?.moved) {
        const { start, in: inPoint, out } = d.current;
        const patch = { start, in: inPoint, out };
        if (d.trackId !== source.id)
          dispatch({ type: 'MOVE_CLIP', clipId: d.clipId, trackId: d.trackId, patch });
        else dispatch({ type: 'UPDATE_CLIP', clipId: d.clipId, patch });
      }
      dragRef.current = null;
      setDrag(null);
    };
    // A finger drag on a clip must not also scroll the timeline.
    const noScroll = (e) => e.cancelable && e.preventDefault();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('touchmove', noScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('touchmove', noScroll);
    };
  }, [drag?.clipId, drag?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const startClipDrag = (e, track, clip, forcedMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelectedId(clip.id);
    setSelectedTransition(null);
    let mode = forcedMode || 'move';
    if (!forcedMode) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < HANDLE_PX) mode = 'left';
      else if (x > rect.width - HANDLE_PX) mode = 'right';
    }
    dragRef.current = {
      clipId: clip.id,
      trackId: track.id,
      mode,
      startX: e.clientX,
      orig: clip,
      current: clip,
      moved: false,
    };
    setDrag(dragRef.current);
  };

  // Touch layout, finger on a clip: a tap selects it, a swipe scrolls the timeline, and a long
  // press on the selected clip picks it up to move it.
  const pressClip = (e, track, clip) => {
    if (e.pointerType !== 'touch') return startClipDrag(e, track, clip);
    e.stopPropagation();
    const press = { x: e.clientX, y: e.clientY, clipId: clip.id, moved: false };
    if (clip.id === selectedId) {
      const ev = { button: 0, clientX: e.clientX, stopPropagation() {} };
      press.timer = setTimeout(() => {
        if (pressRef.current !== press || press.moved) return;
        press.lifted = true;
        navigator.vibrate?.(15);
        startClipDrag(ev, track, clip, 'move');
      }, LONG_PRESS_MS);
    }
    pressRef.current = press;
  };
  const movePress = (e) => {
    const p = pressRef.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
      p.moved = true;
      clearTimeout(p.timer);
    }
  };
  const releasePress = (clip) => {
    const p = pressRef.current;
    pressRef.current = null;
    if (!p || p.clipId !== clip.id) return;
    clearTimeout(p.timer);
    if (!p.moved && !p.lifted) {
      setSelectedId(clip.id);
      setSelectedTransition(null);
    }
  };

  const onTrackDrop = (e, track) => {
    const mediaId = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
    if (!mediaId) return;
    e.preventDefault();
    dispatch({ type: 'ADD_CLIP', mediaId, trackId: track.id, start: timeAt(e.clientX) });
  };

  const accepts = (e, track) =>
    track.kind !== 'text' && e.dataTransfer.types.includes(`${MEDIA_DRAG_TYPE}-${track.kind}`);

  const mainTrack = mainVideoTrack(project);
  const selectTransition = (clip) => {
    setSelectedId(clip.id);
    setSelectedTransition(clip.id);
    onOpenTab('transition');
  };
  const dropOnClip = (e, track, clip) => {
    const look = LOOKS.find((l) => l.id === e.dataTransfer.getData(LOOK_DRAG_TYPE));
    if (look && track.kind === 'video') {
      e.preventDefault();
      e.stopPropagation();
      dispatch({
        type: 'UPDATE_CLIP',
        clipId: clip.id,
        patch: {
          grade: {
            ...look.grade,
            lut: clip.grade?.lut ?? null,
            lutIntensity: clip.grade?.lutIntensity ?? 1,
          },
        },
      });
      setSelectedId(clip.id);
      onOpenTab('color');
      return;
    }
    const type = e.dataTransfer.getData(TRANSITION_DRAG_TYPE);
    if (!type) return;
    e.preventDefault();
    e.stopPropagation();
    if (track !== mainTrack) return;
    dispatch({
      type: 'SET_TRANSITION',
      clipId: clip.id,
      transition: { type, duration: clip.transition?.duration || DEFAULT_TRANSITION_DURATION },
    });
    selectTransition(clip);
  };

  const selectedClip =
    selectedId && project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedId);
  const selectedMedia = selectedClip && project.media[selectedClip.mediaId];
  const canDetach =
    selectedMedia?.hasAudio &&
    !selectedClip.audioDetached &&
    project.tracks.some((t) => t.kind === 'video' && t.clips.includes(selectedClip));

  // Clips shown in each row; a clip being dragged to another track is drawn in that track.
  const rowClips = (track) => {
    const clips = track.clips.filter(
      (c) => !(drag?.moved && c.id === drag.clipId && drag.trackId !== track.id),
    );
    if (drag?.moved && drag.trackId === track.id && !clips.some((c) => c.id === drag.clipId))
      clips.push(drag.orig);
    return clips;
  };

  return (
    <section className={`timeline ${mobile ? 'timeline-touch' : ''}`}>
      {!mobile && (
        <div className="timeline-toolbar">
          <button onClick={onSplit} title="Split at playhead (S)">
            ✂ Split
          </button>
          <button
            onClick={onDelete}
            disabled={!selectedId}
            title={selectedTransition ? 'Remove transition (⌫)' : 'Delete clip (⌫)'}
          >
            🗑 {selectedTransition ? 'Remove transition' : 'Delete'}
          </button>
          <button
            onClick={() => dispatch({ type: 'ADD_TITLE', start: time })}
            title="Add a title at the playhead"
          >
            T+ Title
          </button>
          <button
            onClick={() => dispatch({ type: 'DETACH_AUDIO', clipId: selectedId, newId: uid() })}
            disabled={!canDetach}
            title="Move the selected video's sound to an audio track"
          >
            ♪ Detach audio
          </button>
          <span className="divider" />
          <button
            className={`toggle ${project.settings.magnet ? 'on' : ''}`}
            onClick={() =>
              dispatch({ type: 'SET_SETTINGS', patch: { magnet: !project.settings.magnet } })
            }
            title={
              project.settings.magnet
                ? 'Magnet on: the main track closes gaps automatically when you delete, cut or trim. Click to turn off.'
                : 'Magnet off: deleting leaves gaps. Click to turn on.'
            }
          >
            🧲 Magnet
          </button>
          <span className="divider" />
          <button
            onClick={() => dispatch({ type: 'ADD_VIDEO_TRACK' })}
            title="Add a video track above the others (picture in picture, overlays)"
          >
            + Video track
          </button>
          <button onClick={() => dispatch({ type: 'ADD_AUDIO_TRACK' })} title="Add an audio track">
            + Audio track
          </button>
          <div className="spacer" />
          <span className="muted small">Zoom</span>
          <input
            type="range"
            min="10"
            max="300"
            value={zoom}
            onChange={(e) => setZoom(+e.target.value)}
          />
        </div>
      )}

      <div className="timeline-viewport">
        <div className="timeline-scroll" ref={scrollRef} onScroll={onScroll}>
          <div
            className="timeline-content"
            style={{ width: contentWidth + OFFSET, '--label-w': `${LABEL_WIDTH}px` }}
          >
            <div
              className="ruler-row"
              onPointerDown={(e) => {
                if (mobile) return;
                setTime(timeAt(e.clientX));
                setScrubbing(true);
              }}
            >
              <div className="track-label sticky" />
              <Ruler width={contentWidth} zoom={zoom} offset={OFFSET - LABEL_WIDTH} />
            </div>

            {project.tracks.map((track) => (
              <div
                key={track.id}
                className={`track-row kind-${track.kind} ${track === mainTrack ? 'is-main' : ''} ${track.hidden ? 'is-hidden' : ''} ${track.muted ? 'is-muted' : ''}`}
                ref={(el) =>
                  el ? rowRefs.current.set(track.id, el) : rowRefs.current.delete(track.id)
                }
              >
                {mobile ? (
                  <CompactTrackHeader track={track} dispatch={dispatch} />
                ) : (
                  <TrackHeader project={project} track={track} dispatch={dispatch} />
                )}
                <div
                  className="track-lane"
                  style={{ width: contentWidth, marginLeft: OFFSET - LABEL_WIDTH }}
                  onPointerDown={(e) => {
                    // With a finger, dragging the empty lane scrolls the timeline; a tap moves the playhead.
                    if (e.pointerType === 'touch') {
                      tapRef.current = { x: e.clientX, y: e.clientY };
                      return;
                    }
                    setSelectedId(null);
                    setSelectedTransition(null);
                    setTime(timeAt(e.clientX));
                    setScrubbing(true);
                  }}
                  onPointerUp={(e) => {
                    const tap = tapRef.current;
                    tapRef.current = null;
                    if (!tap || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) return;
                    setSelectedId(null);
                    setSelectedTransition(null);
                    if (!mobile) setTime(timeAt(e.clientX));
                  }}
                  onDragOver={(e) => {
                    if (accepts(e, track)) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                    }
                  }}
                  onDrop={(e) => onTrackDrop(e, track)}
                >
                  {rowClips(track).map((clip) => {
                    const c = drag?.clipId === clip.id ? drag.current : clip;
                    const media = project.media[c.mediaId];
                    const label = track.kind === 'text' ? c.text : media?.name;
                    const speed = clipSpeed(c);
                    const showWave = track.kind === 'audio' && media?.waveform;
                    const tr = track === mainTrack && !drag && transitionInto(track, clip);
                    const keyTimes =
                      track.kind === 'video'
                        ? [
                            ...new Set(
                              ['x', 'y', 'scale', 'rotation', 'opacity'].flatMap((p) =>
                                (localKeyframes(c, p) || []).map((k) => k.local.toFixed(3)),
                              ),
                            ),
                          ]
                        : [];
                    return (
                      <div
                        key={clip.id}
                        className={`clip clip-${track.kind} ${selectedId === clip.id && !selectedTransition ? 'selected' : ''} ${media?.missing ? 'missing' : ''}`}
                        style={{
                          left: c.start * zoom,
                          width: Math.max(4, clipDur(c) * zoom),
                          backgroundImage: showWave
                            ? `url("${mediaUrl(media.waveform)}")`
                            : media?.thumb
                              ? `url("${mediaUrl(media.thumb)}")`
                              : undefined,
                          ...(showWave && {
                            backgroundSize: `${(media.duration / speed) * zoom}px 100%`,
                            backgroundPosition: `${(-c.in / speed) * zoom}px 0`,
                            backgroundRepeat: 'no-repeat',
                          }),
                        }}
                        onPointerDown={(e) =>
                          mobile ? pressClip(e, track, clip) : startClipDrag(e, track, clip)
                        }
                        onPointerMove={mobile ? movePress : undefined}
                        onPointerUp={mobile ? () => releasePress(clip) : undefined}
                        onPointerCancel={mobile ? () => releasePress(clip) : undefined}
                        onDragOver={(e) => {
                          const types = e.dataTransfer.types;
                          if (
                            (track === mainTrack && types.includes(TRANSITION_DRAG_TYPE)) ||
                            (track.kind === 'video' && types.includes(LOOK_DRAG_TYPE))
                          ) {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        onDrop={(e) => dropOnClip(e, track, clip)}
                        title={`${label}${media?.missing ? ' (file missing)' : ''}\n${formatTime(c.start)} – ${formatTime(clipEnd(c))}`}
                      >
                        {c.fadeIn > 0 && (
                          <div className="fade fade-in" style={{ width: c.fadeIn * zoom }} />
                        )}
                        {c.fadeOut > 0 && (
                          <div className="fade fade-out" style={{ width: c.fadeOut * zoom }} />
                        )}
                        {clipAnimations(c).map(({ dir, duration: d, anim }) => (
                          <div
                            key={dir}
                            className={`anim-mark anim-${dir}`}
                            style={{ width: d * zoom }}
                            title={`${dir === 'in' ? 'In' : 'Out'}: ${anim.name}`}
                          />
                        ))}
                        {tr && (
                          <div
                            className={`transition-marker ${selectedTransition === clip.id ? 'selected' : ''}`}
                            style={{ width: Math.max(14, tr.duration * zoom) }}
                            title={`${TRANSITIONS.find((t) => t.id === tr.type)?.name} (${tr.duration.toFixed(2)}s)${tr.prev ? '' : ' from black'}. Click to select, ⌫ to remove.`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              selectTransition(clip);
                            }}
                          >
                            ⧓
                            {selectedTransition === clip.id && (
                              <button
                                className="marker-remove"
                                title="Remove transition"
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  dispatch({
                                    type: 'SET_TRANSITION',
                                    clipId: clip.id,
                                    transition: null,
                                  });
                                  setSelectedTransition(null);
                                }}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        )}
                        {keyTimes.map((k) => (
                          <div key={k} className="kf-diamond" style={{ left: +k * zoom }} />
                        ))}
                        <span className="clip-label">
                          {c.muted ? '🔇 ' : ''}
                          {c.audioDetached ? '⇣ ' : ''}
                          {hasRamp(c) ? 'Ramp · ' : speed !== 1 ? `${+speed.toFixed(2)}× ` : ''}
                          {label}
                        </span>
                      </div>
                    );
                  })}
                  {mobile && track === mainTrack && (
                    <MainTrackExtras
                      track={track}
                      zoom={zoom}
                      hidden={!!drag || (!!selectedId && !selectedTransition)}
                      selectedTransition={selectedTransition}
                      onTransition={selectTransition}
                      onAddMedia={onAddMedia}
                    />
                  )}
                  {mobile &&
                    (() => {
                      const sel = rowClips(track).find((c) => c.id === selectedId);
                      if (!sel || selectedTransition || (drag && drag.mode === 'move')) return null;
                      const c = drag?.clipId === sel.id ? drag.current : sel;
                      return ['left', 'right'].map((side) => (
                        <div
                          key={side}
                          className={`trim-handle trim-${side}`}
                          style={{
                            left: side === 'left' ? c.start * zoom : clipEnd(c) * zoom,
                          }}
                          onPointerDown={(e) => startClipDrag(e, track, sel, side)}
                        >
                          <Icon name="back" size={14} className={side === 'right' ? 'flip' : ''} />
                        </div>
                      ));
                    })()}
                </div>
              </div>
            ))}

            {!mobile && <div className="playhead" style={{ left: LABEL_WIDTH + time * zoom }} />}
          </div>
        </div>
        {mobile && <div className="center-playhead" />}
      </div>
    </section>
  );
}

// Touch layout extras on the main track: a join button between butted clips to add a
// transition, and a "+" after the last clip to add more media.
function MainTrackExtras({ track, zoom, hidden, selectedTransition, onTransition, onAddMedia }) {
  if (hidden) return null;
  const clips = [...track.clips].sort((a, b) => a.start - b.start);
  const end = clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  return (
    <>
      {clips.slice(1).map((clip, i) => {
        if (Math.abs(clipEnd(clips[i]) - clip.start) > 0.001) return null;
        return (
          <button
            key={clip.id}
            className={`join-btn ${clip.transition ? 'has' : ''} ${selectedTransition === clip.id ? 'active' : ''}`}
            style={{ left: clip.start * zoom }}
            title={clip.transition ? 'Edit transition' : 'Add transition'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onTransition(clip)}
          >
            <Icon name={clip.transition ? 'transition' : 'plus'} size={12} />
          </button>
        );
      })}
      {onAddMedia && (
        <button
          className="lane-add"
          style={{ left: end * zoom + 12 }}
          title="Add media"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onAddMedia}
        >
          <Icon name="plus" size={20} />
        </button>
      )}
    </>
  );
}
