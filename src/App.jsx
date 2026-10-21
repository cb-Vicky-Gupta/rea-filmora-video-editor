import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  TRANSFORM_PROPS,
  baseName,
  clipEnd,
  findClip,
  historyReducer,
  newProject,
  projectDuration,
  propAt,
  sourceTime,
  uid,
} from './project.js';
import MediaBin from './components/MediaBin.jsx';
import Preview from './components/Preview.jsx';
import Inspector from './components/Inspector.jsx';
import Timeline from './components/Timeline.jsx';
import ExportDialog from './components/ExportDialog.jsx';

export default function App() {
  const [history, dispatch] = useReducer(historyReducer, null, () => ({
    past: [],
    present: newProject(),
    future: [],
  }));
  const project = history.present;
  const duration = projectDuration(project);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // Clip id whose transition (rather than the clip itself) is selected.
  const [selectedTransition, setSelectedTransition] = useState(null);
  const [zoom, setZoom] = useState(60); // pixels per second
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [inspectorTab, setInspectorTab] = useState('video');
  // Phones show one side panel at a time below the preview.
  const [mobilePanel, setMobilePanel] = useState('library');

  const timeRef = useRef(time);
  timeRef.current = time;

  const notify = useCallback((msg) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 4000);
  }, []);

  // Playback clock: media elements in the preview chase this time.
  useEffect(() => {
    if (!playing) return;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const next = timeRef.current + (now - last) / 1000;
      last = now;
      if (next >= duration) {
        setTime(duration);
        setPlaying(false);
        return;
      }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  const togglePlay = useCallback(() => {
    if (!duration) return;
    if (!playing && timeRef.current >= duration - 0.01) setTime(0);
    setPlaying((p) => !p);
  }, [playing, duration]);

  const splitAtPlayhead = useCallback(() => {
    const t = timeRef.current;
    let target = selectedId && findClip(project, selectedId)?.clip;
    if (!target || t <= target.start || t >= clipEnd(target)) {
      target = project.tracks
        .flatMap((tr) => tr.clips)
        .find((c) => t > c.start && t < clipEnd(c));
    }
    if (target) dispatch({ type: 'SPLIT', clipId: target.id, time: t, newId: uid() });
  }, [project, selectedId]);

  // Keyframes every transform property of the selected video clip at the playhead.
  const keyframeAll = useCallback(() => {
    const found = selectedId && findClip(project, selectedId);
    const t = timeRef.current;
    if (!found || found.track.kind !== 'video' || t < found.clip.start || t > clipEnd(found.clip)) return;
    const { clip } = found;
    for (const prop of Object.keys(TRANSFORM_PROPS)) {
      dispatch({ type: 'SET_KEYFRAME', clipId: clip.id, prop, t: sourceTime(clip, t), v: propAt(clip, prop, t - clip.start) });
    }
    setInspectorTab('video');
  }, [project, selectedId]);

  const deleteSelected = useCallback(() => {
    if (selectedTransition && findClip(project, selectedTransition)?.clip.transition) {
      dispatch({ type: 'SET_TRANSITION', clipId: selectedTransition, transition: null });
      setSelectedTransition(null);
      return;
    }
    if (!selectedId) return;
    dispatch({ type: 'DELETE_CLIP', clipId: selectedId });
    setSelectedId(null);
  }, [project, selectedId, selectedTransition]);

  useEffect(() => {
    const onKey = (e) => {
      // Editing shortcuts are off while a dialog is open.
      if (document.querySelector('.modal-backdrop')) return;
      if (e.target instanceof Element && e.target.closest('input, textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'REDO' : 'UNDO' });
      } else if (!mod && e.key.toLowerCase() === 's') {
        splitAtPlayhead();
      } else if (!mod && e.key.toLowerCase() === 'k') {
        keyframeAll();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        deleteSelected();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const step = e.shiftKey ? 1 : 1 / project.settings.fps;
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        setTime((t) => Math.max(0, Math.min(duration, t + dir * step)));
      } else if (e.key === 'Home') {
        setTime(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, splitAtPlayhead, keyframeAll, deleteSelected, duration, project.settings.fps]);

  const addMedia = useCallback(
    (results) => {
      const ok = results.filter((r) => !r.error);
      const failed = results.filter((r) => r.error);
      if (ok.length) dispatch({ type: 'ADD_MEDIA', items: ok });
      if (failed.length) notify(failed.map((f) => f.error).join(' · '));
    },
    [notify]
  );

  const openProject = async () => {
    const loaded = await window.api.openProject();
    if (!loaded) return;
    dispatch({ type: 'LOAD_PROJECT', project: loaded });
    setTime(0);
    setPlaying(false);
    setSelectedId(null);
  };

  const saveProject = async () => {
    const saved = await window.api.saveProject(project);
    if (saved) notify(`Saved ${baseName(saved)}`);
  };

  const selected = selectedId ? findClip(project, selectedId) : null;
  useEffect(() => {
    if (selectedId) setMobilePanel('edit');
  }, [selectedId]);
  // Only treat the transition as selected while the clip still has one.
  const transitionSel = selectedTransition && findClip(project, selectedTransition)?.clip.transition ? selectedTransition : null;

  return (
    <div className={`app platform-${window.api?.platform || 'web'}`} data-panel={mobilePanel}>
      <header className="titlebar">
        <div className="brand">ReaCut</div>
        <div className="titlebar-actions">
          <button onClick={openProject}>Open</button>
          <button onClick={saveProject}>Save</button>
          <span className="divider" />
          <button onClick={() => dispatch({ type: 'UNDO' })} disabled={!history.past.length} title="Undo (⌘Z)">
            ↶
          </button>
          <button onClick={() => dispatch({ type: 'REDO' })} disabled={!history.future.length} title="Redo (⇧⌘Z)">
            ↷
          </button>
          <span className="divider" />
          <button className="primary" onClick={() => setExportOpen(true)} disabled={!duration}>
            Export
          </button>
        </div>
      </header>

      <main className="workspace">
        <MediaBin project={project} dispatch={dispatch} onImported={addMedia} selected={selected} time={time} />
        <Preview
          project={project}
          time={time}
          playing={playing}
          duration={duration}
          onTogglePlay={togglePlay}
          setTime={setTime}
        />
        <nav className="mobile-tabs">
          {[
            ['library', 'Library'],
            ['edit', selected ? 'Edit clip' : 'Project'],
            ['none', 'Hide panel'],
          ].map(([id, label]) => (
            <button key={id} className={mobilePanel === id ? 'active' : ''} onClick={() => setMobilePanel(id)}>
              {label}
            </button>
          ))}
        </nav>
        <Inspector
          project={project}
          selected={selected}
          dispatch={dispatch}
          time={time}
          setTime={(t) => setTime(Math.max(0, t))}
          tab={inspectorTab}
          setTab={setInspectorTab}
          notify={notify}
        />
      </main>

      <Timeline
        project={project}
        time={time}
        setTime={(t) => setTime(Math.max(0, t))}
        playing={playing}
        duration={duration}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        selectedTransition={transitionSel}
        setSelectedTransition={setSelectedTransition}
        dispatch={dispatch}
        zoom={zoom}
        setZoom={setZoom}
        onSplit={splitAtPlayhead}
        onDelete={deleteSelected}
        onOpenTab={setInspectorTab}
      />

      {exportOpen && <ExportDialog project={project} duration={duration} time={time} onClose={() => setExportOpen(false)} />}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
