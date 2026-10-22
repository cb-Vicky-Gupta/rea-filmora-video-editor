import { useEffect, useState } from 'react';
import { clipEnd, formatTime, mainVideoTrack, uid } from '../project.js';
import Preview from './Preview.jsx';
import Timeline from './Timeline.jsx';
import Icon, { PlayIcon } from './icons.jsx';
import SpeedControls from './SpeedRamp.jsx';
import { FiltersTab, MediaTab, TitlesTab } from './MediaBin.jsx';
import {
  AnimationTab,
  AudioTab,
  ColorTab,
  ProjectFields,
  TitleTab,
  TransitionTab,
  VideoTab,
} from './Inspector.jsx';

const SHEET_TITLES = {
  media: 'Add media',
  overlay: 'Overlay',
  audio: 'Audio',
  text: 'Text',
  filters: 'Filters',
  project: 'Project',
  video: 'Edit',
  speed: 'Speed',
  color: 'Adjust',
  animation: 'Animation',
  'clip-audio': 'Volume',
  transition: 'Transition',
  title: 'Edit text',
};

// Sheets that edit the selected clip; they close when the selection goes away.
const CLIP_SHEETS = new Set([
  'video',
  'speed',
  'color',
  'animation',
  'clip-audio',
  'title',
  'filters',
]);

function ToolButton({ icon, label, onClick, disabled, active }) {
  return (
    <button className={`tool-btn ${active ? 'active' : ''}`} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

// Phone/tablet editor: preview on top, a scrubbable timeline with a fixed centre playhead,
// and a bottom tool bar whose tools open bottom sheets. Mirrors the layout people know from
// mobile editors, so every action is a thumb tap away.
export default function MobileEditor({
  project,
  history,
  dispatch,
  time,
  setTime,
  playing,
  setPlaying,
  togglePlay,
  duration,
  selected,
  setSelectedId,
  selectedTransition,
  setSelectedTransition,
  zoom,
  setZoom,
  onSplit,
  onDelete,
  onKeyframe,
  onImported,
  onOpenProject,
  onSaveProject,
  onExport,
  notify,
}) {
  const [sheet, setSheet] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);

  const clip = selected?.clip;
  const track = selected?.track;
  const media = clip && project.media[clip.mediaId];
  const mainTrack = mainVideoTrack(project);
  const { width, height, fps } = project.settings;

  // Selecting a transition join opens its sheet; losing the selection closes clip sheets.
  useEffect(() => {
    if (selectedTransition) setSheet('transition');
  }, [selectedTransition]);
  useEffect(() => {
    if (!selected && CLIP_SHEETS.has(sheet)) setSheet(null);
    if (sheet === 'transition' && !selectedTransition) setSheet(null);
  }, [selected, selectedTransition, sheet]);

  const closeSheet = () => {
    if (sheet === 'transition') setSelectedTransition(null);
    setSheet(null);
  };
  const deselect = () => {
    setSelectedId(null);
    setSelectedTransition(null);
    setSheet(null);
  };

  const importMedia = async () => {
    setBusy(true);
    try {
      onImported(await window.api.importMedia());
    } finally {
      setBusy(false);
    }
  };

  // The video clip under the playhead on the main track, for tools opened with nothing selected.
  const openForClipAtPlayhead = (id) => {
    const hit = mainTrack.clips.find((c) => time >= c.start && time < clipEnd(c));
    if (!hit) return notify('Move the playhead over a video clip first');
    setSelectedId(hit.id);
    setSheet(id);
  };

  const overlayTrack = project.tracks.find((t) => t.kind === 'video' && t !== mainTrack);
  const openOverlay = () => {
    if (!overlayTrack) dispatch({ type: 'ADD_VIDEO_TRACK' });
    setSheet('overlay');
  };

  const addClip = (m, trackId, start) => {
    const clipId = uid();
    dispatch({ type: 'ADD_CLIP', mediaId: m.id, trackId, start, clipId });
    return clipId;
  };

  // ---------------- Sheets ----------------

  const importButton = (
    <button className="primary sheet-import" onClick={importMedia} disabled={busy}>
      <Icon name="plus" size={18} />
      {busy ? 'Importing…' : 'Import from device'}
    </button>
  );

  const renderSheet = () => {
    switch (sheet) {
      case 'media':
        return (
          <>
            {importButton}
            <div className="sheet-hint">Tap an item to add it to the end of the main track.</div>
            <MediaTab
              project={project}
              dispatch={dispatch}
              busy={busy}
              filter={(m) => m.kind !== 'audio'}
              onPick={(m) => {
                addClip(m, mainTrack.id);
                notify(`Added ${m.name}`);
              }}
              empty={<div className="empty-hint">No videos or photos yet.</div>}
            />
          </>
        );
      case 'overlay':
        return (
          <>
            {importButton}
            <div className="sheet-hint">
              Tap an item to layer it over the video at the playhead (picture in picture).
            </div>
            <MediaTab
              project={project}
              dispatch={dispatch}
              busy={busy}
              filter={(m) => m.kind !== 'audio'}
              onPick={(m) => {
                if (!overlayTrack) return;
                const id = addClip(m, overlayTrack.id, time);
                setSelectedId(id);
                setSheet('video');
              }}
              empty={<div className="empty-hint">Import a video or photo to overlay.</div>}
            />
          </>
        );
      case 'audio':
        return (
          <>
            {importButton}
            <div className="sheet-hint">
              Tap a sound to place it at the playhead. Videos with sound can be used too.
            </div>
            <MediaTab
              project={project}
              dispatch={dispatch}
              busy={busy}
              filter={(m) => m.kind === 'audio' || (m.kind === 'video' && m.hasAudio)}
              onPick={(m) => {
                const target =
                  project.tracks.find(
                    (t) =>
                      t.kind === 'audio' &&
                      !t.clips.some((c) => time < clipEnd(c) && time + 0.1 > c.start),
                  ) || project.tracks.find((t) => t.kind === 'audio');
                addClip(m, target.id, time);
                notify(`Added ${m.name}`);
              }}
              empty={<div className="empty-hint">Import music or a voice-over.</div>}
            />
            <button
              className="sheet-secondary"
              onClick={() => dispatch({ type: 'ADD_AUDIO_TRACK' })}
            >
              <Icon name="track" size={18} /> Add audio track
            </button>
          </>
        );
      case 'text':
        return (
          <TitlesTab
            dispatch={dispatch}
            time={time}
            hint="Tap a style to add it at the playhead."
            onAdd={(preset) => {
              const clipId = uid();
              dispatch({ type: 'ADD_TITLE', start: time, preset, clipId });
              setSelectedId(clipId);
              setSheet('title');
            }}
          />
        );
      case 'filters':
        return (
          <FiltersTab
            selected={selected}
            dispatch={dispatch}
            thumb={selected?.track.kind === 'video' ? media?.thumb : null}
            hint={
              selected?.track.kind === 'video'
                ? 'Tap a filter to apply it. Fine-tune it in Adjust.'
                : 'Select a video clip first.'
            }
          />
        );
      case 'project':
        return (
          <div className="sheet-form">
            <div className="sheet-row">
              <button onClick={onOpenProject}>
                <Icon name="folder" size={18} /> Open project
              </button>
              <button onClick={onSaveProject}>
                <Icon name="save" size={18} /> Save project
              </button>
            </div>
            <ProjectFields project={project} dispatch={dispatch} />
            <label className="check">
              <input
                type="checkbox"
                checked={!!project.settings.magnet}
                onChange={(e) =>
                  dispatch({ type: 'SET_SETTINGS', patch: { magnet: e.target.checked } })
                }
              />
              Magnetic main track (close gaps automatically)
            </label>
          </div>
        );
      case 'video':
        return (
          <div className="sheet-form">
            <VideoTab
              project={project}
              clip={clip}
              media={media}
              track={track}
              time={time}
              setTime={(t) => setTime(Math.max(0, t))}
              dispatch={dispatch}
              showSpeed={false}
            />
          </div>
        );
      case 'speed':
        return (
          <div className="sheet-form">
            <SpeedControls
              key={clip.id}
              clip={clip}
              media={media}
              time={time}
              dispatch={dispatch}
            />
          </div>
        );
      case 'color':
        return (
          <div className="sheet-form">
            <ColorTab clip={clip} media={media} dispatch={dispatch} notify={notify} />
          </div>
        );
      case 'animation':
        return (
          <div className="sheet-form">
            <AnimationTab clip={clip} isText={track.kind === 'text'} dispatch={dispatch} />
          </div>
        );
      case 'clip-audio':
        return (
          <div className="sheet-form">
            <AudioTab clip={clip} media={media} track={track} dispatch={dispatch} />
          </div>
        );
      case 'title':
        return (
          <div className="sheet-form">
            <TitleTab clip={clip} dispatch={dispatch} />
          </div>
        );
      case 'transition':
        return (
          <div className="sheet-form">
            <TransitionTab clip={clip} track={track} dispatch={dispatch} />
          </div>
        );
      default:
        return null;
    }
  };

  // ---------------- Tool bar ----------------

  let tools;
  if (!selected) {
    tools = (
      <>
        <ToolButton icon="media" label="Media" onClick={() => setSheet('media')} />
        <ToolButton icon="audio" label="Audio" onClick={() => setSheet('audio')} />
        <ToolButton icon="text" label="Text" onClick={() => setSheet('text')} />
        <ToolButton icon="overlay" label="Overlay" onClick={openOverlay} />
        <ToolButton
          icon="filter"
          label="Filters"
          onClick={() => openForClipAtPlayhead('filters')}
          disabled={!mainTrack.clips.length}
        />
        <ToolButton
          icon="adjust"
          label="Adjust"
          onClick={() => openForClipAtPlayhead('color')}
          disabled={!mainTrack.clips.length}
        />
        <ToolButton icon="format" label="Format" onClick={() => setSheet('project')} />
        <ToolButton
          icon="magnet"
          label="Magnet"
          active={!!project.settings.magnet}
          onClick={() =>
            dispatch({ type: 'SET_SETTINGS', patch: { magnet: !project.settings.magnet } })
          }
        />
      </>
    );
  } else {
    const kind = track.kind;
    const canDetach = kind === 'video' && media?.hasAudio && !clip.audioDetached;
    const inClip = time > clip.start && time < clipEnd(clip);
    tools = (
      <>
        <ToolButton icon="split" label="Split" onClick={onSplit} disabled={!inClip} />
        {kind === 'text' && (
          <ToolButton icon="edit" label="Edit text" onClick={() => setSheet('title')} />
        )}
        {kind === 'video' && (
          <ToolButton icon="edit" label="Edit" onClick={() => setSheet('video')} />
        )}
        {media?.kind === 'video' && (
          <ToolButton icon="speed" label="Speed" onClick={() => setSheet('speed')} />
        )}
        {kind === 'video' && (
          <ToolButton icon="filter" label="Filters" onClick={() => setSheet('filters')} />
        )}
        {kind === 'video' && (
          <ToolButton icon="adjust" label="Adjust" onClick={() => setSheet('color')} />
        )}
        {kind !== 'audio' && (
          <ToolButton icon="animation" label="Animation" onClick={() => setSheet('animation')} />
        )}
        {(kind === 'audio' || media?.hasAudio) && (
          <ToolButton icon="volume" label="Volume" onClick={() => setSheet('clip-audio')} />
        )}
        {track === mainTrack && (
          <ToolButton
            icon="transition"
            label="Transition"
            onClick={() => setSelectedTransition(clip.id)}
          />
        )}
        {kind === 'video' && (
          <ToolButton
            icon="keyframe"
            label="Keyframe"
            onClick={() => {
              onKeyframe();
              notify('Keyframe added at the playhead');
            }}
            disabled={time < clip.start || time > clipEnd(clip)}
          />
        )}
        {canDetach && (
          <ToolButton
            icon="detach"
            label="Extract audio"
            onClick={() => dispatch({ type: 'DETACH_AUDIO', clipId: clip.id, newId: uid() })}
          />
        )}
        <ToolButton icon="trash" label="Delete" onClick={onDelete} />
      </>
    );
  }

  const resLabel = height === 2160 || width === 2160 ? '4K' : `${Math.min(width, height)}p`;

  return (
    <div className={`m-app ${fullscreen ? 'is-fullscreen' : ''} ${sheet ? 'has-sheet' : ''}`}>
      <header className="m-top">
        <button className="m-icon" onClick={() => setSheet('project')} title="Project">
          <Icon name="folder" />
        </button>
        <button className="m-chip" onClick={() => setSheet('project')}>
          {resLabel} · {fps} fps
        </button>
        <button className="m-export" onClick={onExport} disabled={!duration}>
          Export
        </button>
      </header>

      <Preview
        project={project}
        time={time}
        playing={playing}
        duration={duration}
        onTogglePlay={togglePlay}
        setTime={setTime}
        showTransport={false}
      />

      <div className="m-transport">
        <span className="m-time">
          {formatTime(time)} <span className="muted">/ {formatTime(duration)}</span>
        </span>
        <button
          className="m-play"
          onClick={togglePlay}
          disabled={!duration}
          title={playing ? 'Pause' : 'Play'}
        >
          <PlayIcon playing={playing} size={24} />
        </button>
        <span className="m-transport-right">
          <button
            className="m-icon"
            onClick={() => dispatch({ type: 'UNDO' })}
            disabled={!history.past.length}
            title="Undo"
          >
            <Icon name="undo" size={20} />
          </button>
          <button
            className="m-icon"
            onClick={() => dispatch({ type: 'REDO' })}
            disabled={!history.future.length}
            title="Redo"
          >
            <Icon name="redo" size={20} />
          </button>
          <button
            className="m-icon"
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? 'Exit full screen' : 'Full screen preview'}
          >
            <Icon name={fullscreen ? 'collapse' : 'expand'} size={20} />
          </button>
        </span>
      </div>

      <div className="m-lower">
        <Timeline
          project={project}
          time={time}
          setTime={(t) => setTime(Math.max(0, t))}
          playing={playing}
          duration={duration}
          selectedId={selected?.clip.id ?? null}
          setSelectedId={setSelectedId}
          selectedTransition={selectedTransition}
          setSelectedTransition={setSelectedTransition}
          dispatch={dispatch}
          zoom={zoom}
          setZoom={setZoom}
          onSplit={onSplit}
          onDelete={onDelete}
          onOpenTab={() => {}}
          mobile
          onScrub={() => playing && setPlaying(false)}
          onAddMedia={() => setSheet('media')}
        />

        <nav className={`m-toolbar ${selected ? 'is-context' : ''}`}>
          {selected && (
            <button className="tool-back" onClick={deselect} title="Done">
              <Icon name="back" />
            </button>
          )}
          <div className="m-tools">{tools}</div>
        </nav>

        {sheet && (
          <div className="m-sheet" role="dialog" aria-label={SHEET_TITLES[sheet]}>
            <div className="m-sheet-head">
              <span>{SHEET_TITLES[sheet]}</span>
              {clip && CLIP_SHEETS.has(sheet) && (
                <span className="m-sheet-sub">
                  {track.kind === 'text' ? clip.text.split('\n')[0] : media?.name}
                </span>
              )}
              <button className="m-icon" onClick={closeSheet} title="Done">
                <Icon name="check" />
              </button>
            </div>
            <div className="m-sheet-body">{renderSheet()}</div>
          </div>
        )}
      </div>
    </div>
  );
}
