import { useState } from 'react';
import {
  DEFAULT_TRANSITION_DURATION,
  TRANSITIONS,
  formatTime,
  mainVideoTrack,
  mediaUrl,
  trackAccepts,
} from '../project.js';
import { LOOKS } from '../../shared/grade.mjs';
import { LookSwatch } from './Inspector.jsx';

export const MEDIA_DRAG_TYPE = 'application/x-reacut-media';
export const TRANSITION_DRAG_TYPE = 'application/x-reacut-transition';
export const LOOK_DRAG_TYPE = 'application/x-reacut-look';

const TITLE_PRESETS = [
  {
    name: 'Basic Title',
    preset: {
      text: 'Your Title',
      fontSize: 96,
      color: '#ffffff',
      x: 0.5,
      y: 0.5,
      animIn: { type: 'fade', duration: 0.5 },
      animOut: { type: 'fade', duration: 0.5 },
    },
  },
  {
    name: 'Big Bold',
    preset: {
      text: 'BIG NEWS',
      fontSize: 170,
      color: '#ffd54a',
      x: 0.5,
      y: 0.5,
      animIn: { type: 'rise', duration: 0.6 },
      animOut: { type: 'fade', duration: 0.4 },
    },
  },
  {
    name: 'Lower Third',
    preset: {
      text: 'Jane Doe\nDirector',
      fontSize: 54,
      color: '#ffffff',
      x: 0.25,
      y: 0.82,
      box: true,
      animIn: { type: 'slide-right', duration: 0.6 },
      animOut: { type: 'slide-left', duration: 0.5 },
    },
  },
  {
    name: 'Subtitle',
    preset: {
      text: 'Subtitle text',
      fontSize: 48,
      color: '#ffffff',
      x: 0.5,
      y: 0.9,
      box: true,
      animIn: { type: 'fade', duration: 0.2 },
      animOut: { type: 'fade', duration: 0.2 },
    },
  },
  {
    name: 'Top Heading',
    preset: {
      text: 'Chapter One',
      fontSize: 72,
      color: '#ffffff',
      x: 0.5,
      y: 0.14,
      animIn: { type: 'drop', duration: 0.6 },
      animOut: { type: 'rise', duration: 0.5 },
    },
  },
  {
    name: 'The End',
    preset: {
      text: 'The End',
      fontSize: 130,
      color: '#ffffff',
      x: 0.5,
      y: 0.5,
      out: 4,
      animIn: { type: 'fade', duration: 1.2 },
      animOut: { type: 'fade', duration: 1.2 },
    },
  },
];

const KIND_ICON = { video: '▶', audio: '♪', image: '▣' };

function TitlesTab({ dispatch, time }) {
  return (
    <>
      <div className="empty-hint left">
        Click a style to add it at the playhead, then edit the text in the panel on the right.
      </div>
      <div className="title-lib">
        {TITLE_PRESETS.map((t) => (
          <button
            key={t.name}
            className="title-tile"
            onClick={() => dispatch({ type: 'ADD_TITLE', start: time, preset: t.preset })}
          >
            <div
              className={`title-art ${t.preset.box ? 'boxed' : ''}`}
              style={{
                color: t.preset.color,
                justifyContent:
                  t.preset.y > 0.7 ? 'flex-end' : t.preset.y < 0.3 ? 'flex-start' : 'center',
                alignItems: t.preset.x < 0.4 ? 'flex-start' : 'center',
              }}
            >
              <span>{t.preset.text.split('\n')[0]}</span>
            </div>
            <span>{t.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function FiltersTab({ selected, dispatch }) {
  const target = selected?.track.kind === 'video' ? selected.clip : null;
  return (
    <>
      <div className="empty-hint left">
        Drag a filter onto a video clip, or select a clip and click one. Fine-tune it in the Color
        tab.
      </div>
      <div className="transition-lib">
        {LOOKS.map((l) => (
          <div
            key={l.id}
            className="transition-tile"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(LOOK_DRAG_TYPE, l.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() =>
              target &&
              dispatch({
                type: 'UPDATE_CLIP',
                clipId: target.id,
                patch: {
                  grade: {
                    ...l.grade,
                    lut: target.grade?.lut ?? null,
                    lutIntensity: target.grade?.lutIntensity ?? 1,
                  },
                },
              })
            }
            title={target ? 'Apply to the selected clip' : 'Drag onto a video clip'}
          >
            <LookSwatch thumb={null} grade={l.grade} />
            <span>{l.name}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function MediaTab({ project, dispatch, busy }) {
  const items = Object.values(project.media);
  if (items.length === 0) {
    return (
      <div className="empty-hint">
        Drop videos, music or images here
        <br />
        or click <b>Import</b>.
      </div>
    );
  }
  return (
    <div className="media-grid">
      {items.map((m) => (
        <div
          key={m.id}
          className="media-item"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(MEDIA_DRAG_TYPE, m.id);
            for (const kind of ['video', 'audio']) {
              if (trackAccepts({ kind }, m))
                e.dataTransfer.setData(`${MEDIA_DRAG_TYPE}-${kind}`, '');
            }
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onDoubleClick={() => dispatch({ type: 'ADD_CLIP', mediaId: m.id })}
          // Touch screens can't drag onto the timeline; a tap adds the clip at the end.
          onClick={() =>
            window.matchMedia('(pointer: coarse)').matches &&
            !m.missing &&
            dispatch({ type: 'ADD_CLIP', mediaId: m.id })
          }
          title={`${m.name}\nDouble-click to add to the end of the timeline`}
        >
          <div className={`media-thumb ${m.missing ? 'missing' : ''}`}>
            {m.missing && <span className="media-badge danger">Missing</span>}
            {m.proxy && !m.missing && (
              <span className="media-badge" title="Preview uses an optimized copy">
                Proxy
              </span>
            )}
            {m.thumb ? (
              <img src={mediaUrl(m.thumb)} alt="" draggable={false} />
            ) : m.waveform ? (
              <img className="wave" src={mediaUrl(m.waveform)} alt="" draggable={false} />
            ) : (
              <span>{KIND_ICON[m.kind]}</span>
            )}
            <span className="media-duration">
              {m.kind === 'image' ? 'IMG' : formatTime(m.duration, false)}
            </span>
            <button
              className="media-remove"
              title="Remove from project"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: 'REMOVE_MEDIA', mediaId: m.id });
              }}
            >
              ×
            </button>
          </div>
          <div className="media-name">{m.name}</div>
        </div>
      ))}
    </div>
  );
}

function TransitionsTab({ project, selected, dispatch }) {
  const target = selected?.track === mainVideoTrack(project) ? selected.clip : null;
  return (
    <>
      <div className="empty-hint left">
        Drag a transition onto a clip on the main video track, or select a clip and click one. It
        plays from the previous clip (or from black) into that clip.
      </div>
      <div className="transition-lib">
        {TRANSITIONS.map((t) => (
          <div
            key={t.id}
            className={`transition-tile tr-${t.id} ${target?.transition?.type === t.id ? 'active' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(TRANSITION_DRAG_TYPE, t.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() =>
              target &&
              dispatch({
                type: 'SET_TRANSITION',
                clipId: target.id,
                transition: {
                  type: t.id,
                  duration: target.transition?.duration || DEFAULT_TRANSITION_DURATION,
                },
              })
            }
            title={target ? `Apply to the selected clip` : 'Drag onto a video clip'}
          >
            <div className="transition-art">
              <div className="a" />
              <div className="b" />
            </div>
            <span>{t.name}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const TABS = [
  ['media', 'Media'],
  ['titles', 'Titles'],
  ['transitions', 'Transitions'],
  ['filters', 'Filters'],
];

export default function MediaBin({ project, dispatch, onImported, selected, time }) {
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [tab, setTab] = useState('media');

  const run = async (fn) => {
    setBusy(true);
    try {
      onImported(await fn());
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    if (files.length) {
      setTab('media');
      run(() => window.api.probeFiles(files));
    }
  };

  return (
    <section
      className={`panel media-bin ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      <div className="panel-header tabs library-tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="bin-body">
        {tab === 'media' && (
          <>
            <div className="bin-actions">
              <button
                className="primary"
                onClick={() => run(window.api.importMedia)}
                disabled={busy}
              >
                {busy ? 'Importing…' : '+ Import media'}
              </button>
            </div>
            <MediaTab project={project} dispatch={dispatch} busy={busy} />
          </>
        )}
        {tab === 'titles' && <TitlesTab dispatch={dispatch} time={time} />}
        {tab === 'transitions' && (
          <TransitionsTab project={project} selected={selected} dispatch={dispatch} />
        )}
        {tab === 'filters' && <FiltersTab selected={selected} dispatch={dispatch} />}
      </div>
    </section>
  );
}
