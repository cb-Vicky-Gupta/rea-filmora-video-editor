import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { animValue, clipDur, formatTime, mediaUrl } from '../project.js';
import { parseCube } from '../../shared/grade.mjs';
import { GLRenderer } from '../preview/GLRenderer.js';
import { MediaPool, resumeAudio } from '../preview/MediaPool.js';
import { buildScene } from '../preview/scene.js';

const images = new Map();
function imageFor(path) {
  let img = images.get(path);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = mediaUrl(path);
    images.set(path, img);
  }
  return img;
}

// Parsed .cube files used by clips, loaded on demand.
function useCubes(project) {
  const cache = useRef(new Map());
  const [, bump] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    for (const track of project.tracks) {
      for (const c of track.clips) {
        const p = c.grade?.lut?.path;
        if (!p || cache.current.has(p)) continue;
        cache.current.set(p, null);
        window.api
          .readLut(p)
          .then((text) => cache.current.set(p, parseCube(text)))
          .catch(() => cache.current.set(p, null))
          .finally(bump);
      }
    }
  });
  return cache.current;
}

export default function Preview({ project, time, playing, duration, onTogglePlay, setTime }) {
  const { width, height } = project.settings;
  const textTrack = project.tracks.find((t) => t.kind === 'text');
  const titles = textTrack.hidden
    ? []
    : textTrack.clips.filter((c) => time >= c.start && time < c.start + clipDur(c));

  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const poolsRef = useRef(null);
  const sceneRef = useRef(null);
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };
  const [glError, setGlError] = useState(null);
  const cubes = useCubes(project);

  useEffect(() => {
    poolsRef.current = { video: new MediaPool('video'), audio: new MediaPool('audio') };
    try {
      rendererRef.current = new GLRenderer(canvasRef.current);
    } catch (e) {
      setGlError(String(e.message || e));
    }
    let raf;
    const loop = () => {
      const scene = sceneRef.current;
      if (scene && rendererRef.current)
        rendererRef.current.draw(sizeRef.current.width, sizeRef.current.height, scene);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      poolsRef.current.video.dispose();
      poolsRef.current.audio.dispose();
    };
  }, []);

  // Point media elements at the current time and hand the frame description to the draw loop.
  useEffect(() => {
    const pools = poolsRef.current;
    const scene = buildScene(project, time);
    if (playing) resumeAudio();
    for (const [item, slot] of pools.video.sync(scene.videoItems, playing)) {
      if (item.layer) item.layer.source = slot.el;
    }
    pools.audio.sync(scene.audioItems, playing);
    for (const layer of [scene.current, scene.prev, ...scene.overlays]) {
      if (!layer) continue;
      if (layer.media.kind === 'image') layer.source = imageFor(layer.media.path);
      layer.cube = layer.grade.lut ? cubes.get(layer.grade.lut.path) : null;
    }
    sceneRef.current = scene;
  });

  // Fit the canvas to the panel while keeping the project's aspect ratio.
  const stageRef = useRef(null);
  const [box, setBox] = useState({ w: 640, h: 360 });
  useLayoutEffect(() => {
    const el = stageRef.current;
    const ro = new ResizeObserver(([entry]) => {
      const { width: cw, height: ch } = entry.contentRect;
      const ratio = width / height;
      const w = Math.min(cw, ch * ratio);
      setBox({ w, h: w / ratio });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(2, Math.round(Math.min(box.w * dpr, width)));
    canvas.height = Math.max(2, Math.round(Math.min(box.h * dpr, height)));
  }, [box, width, height]);

  const fontScale = box.h / 1080;

  return (
    <section className="panel preview">
      <div className="preview-stage" ref={stageRef}>
        <div
          className="preview-canvas"
          style={{ width: box.w, height: box.h }}
          onClick={onTogglePlay}
        >
          <canvas ref={canvasRef} className="preview-media" />
          {titles.map((c) => (
            <div
              key={c.id}
              className={`preview-title ${c.box ? 'boxed' : ''}`}
              style={{
                left: `${(c.x + animValue(c, 'x', time - c.start)) * 100}%`,
                top: `${(c.y + animValue(c, 'y', time - c.start)) * 100}%`,
                opacity: animValue(c, 'opacity', time - c.start),
                fontSize: c.fontSize * fontScale,
                color: c.color,
                padding: c.box ? 20 * fontScale : 0,
              }}
            >
              {c.text}
            </div>
          ))}
          {!duration && <div className="preview-empty">Add media to the timeline to preview</div>}
          {glError && <div className="preview-empty">Preview unavailable: {glError}</div>}
        </div>
      </div>

      <div className="transport">
        <button onClick={() => setTime(0)} title="Go to start (Home)">
          ⏮
        </button>
        <button
          className="play"
          onClick={onTogglePlay}
          disabled={!duration}
          title="Play / Pause (Space)"
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="timecode">
          {formatTime(time)} <span className="muted">/ {formatTime(duration)}</span>
        </span>
      </div>
    </section>
  );
}
