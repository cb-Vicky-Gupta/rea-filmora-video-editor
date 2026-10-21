import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, mainVideoTrack, mediaUrl } from '../project.js';
import {
  AUDIO_BITRATES,
  FORMATS,
  FRAME_RATES,
  PRESETS,
  QUALITY_LEVELS,
  SAMPLE_RATES,
  SPEEDS,
  defaultSettings,
  estimateSize,
  formatById,
  formatBytes,
  resolutionOptions,
  sanitizeFileName,
} from '../../shared/export.mjs';

const STORAGE_KEY = 'reacut.exportSettings';
const isMac = window.api.platform === 'darwin';
const isAndroid = window.api.platform === 'android';

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function save(settings) {
  try {
    // The range belongs to this timeline only; everything else is remembered.
    const rest = { ...settings };
    delete rest.range;
    delete rest.rangeStart;
    delete rest.rangeEnd;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // Settings just won't be remembered.
  }
}

function Row({ label, children, hint }) {
  return (
    <div className="ex-row">
      <div className="ex-label">{label}</div>
      <div className="ex-control">
        {children}
        {hint && <div className="ex-hint">{hint}</div>}
      </div>
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o.id}
          className={value === o.id ? 'active' : ''}
          onClick={() => onChange(o.id)}
          disabled={o.disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function parseTime(text) {
  const parts = text.trim().split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function TimeInput({ value, onChange, max }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  const commit = () => {
    const t = parseTime(text);
    if (t === null) setText(formatTime(value));
    else onChange(Math.max(0, Math.min(max, t)));
  };
  return (
    <input
      className="time-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

const fmtDuration = (sec) => {
  if (!Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
};

export default function ExportDialog({ project, duration, time, onClose }) {
  const [settings, setSettings] = useState(() => ({
    ...defaultSettings(project),
    ...loadSaved(),
    // Size and frame rate follow the project unless a preset or the user changes them.
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    rangeEnd: duration,
  }));
  const [preset, setPreset] = useState('project');
  const [sep, setSep] = useState('/');
  const [exists, setExists] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | exporting | done | error | cancelled
  const [progress, setProgress] = useState({ progress: 0, fps: 0, speed: 0, size: 0 });
  const [error, setError] = useState('');
  const [outPath, setOutPath] = useState('');
  const startedAt = useRef(0);
  const [now, setNow] = useState(Date.now());

  const set = (patch) => {
    setPreset('custom');
    setSettings((s) => ({ ...s, ...patch }));
  };

  useEffect(() => {
    window.api.exportDefaults().then((d) => {
      setSep(d.sep);
      setSettings((s) => (s.folder ? s : { ...s, folder: d.folder }));
    });
  }, []);
  useEffect(() => window.api.onExportProgress(setProgress), []);
  useEffect(() => {
    if (status !== 'exporting') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [status]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && status !== 'exporting') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, onClose]);

  const s = settings;
  const format = formatById(s.format);
  const fileName = `${sanitizeFileName(s.name)}.${format.ext}`;
  const fullPath = s.folder ? `${s.folder.replace(/[\\/]+$/, '')}${sep}${fileName}` : '';

  useEffect(() => {
    let live = true;
    if (fullPath) window.api.exists(fullPath).then((e) => live && setExists(e));
    return () => {
      live = false;
    };
  }, [fullPath, status]);

  const resolutions = useMemo(() => {
    const list = resolutionOptions(project);
    if (!list.some((r) => r.width === s.width && r.height === s.height)) {
      list.unshift({ width: s.width, height: s.height, label: `${s.width}×${s.height}` });
    }
    return list;
  }, [project, s.width, s.height]);

  const rangeLen = s.range === 'custom' ? Math.max(0, s.rangeEnd - s.rangeStart) : duration;
  const size = estimateSize(s, rangeLen);
  const hasVideo = !!format.video;
  const usesRate = hasVideo && format.video !== 'prores' && format.video !== 'gif';
  const hwAvailable = isMac && (format.video === 'h264' || format.video === 'hevc');
  const usesQuality = (usesRate && s.rateMode === 'crf') || format.video === 'prores';
  const aspectDiffers =
    Math.abs(s.width / s.height - project.settings.width / project.settings.height) > 0.01;
  const thumb = mainVideoTrack(project)
    .clips.map((c) => project.media[c.mediaId]?.thumb)
    .find(Boolean);

  const applyPreset = (id) => {
    const p = PRESETS.find((x) => x.id === id);
    setPreset(id);
    setSettings((cur) => ({
      ...cur,
      width: project.settings.width,
      height: project.settings.height,
      fps: project.settings.fps,
      ...p.settings,
    }));
  };

  const start = async () => {
    if (!fullPath) return;
    save(s);
    setOutPath(fullPath);
    setProgress({ progress: 0, fps: 0, speed: 0, size: 0 });
    setStatus('exporting');
    startedAt.current = Date.now();
    try {
      const res = await window.api.startExport(project, fullPath, {
        ...s,
        hardware: s.hardware && hwAvailable,
      });
      setStatus(res.ok ? 'done' : 'cancelled');
    } catch (e) {
      setError(
        String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''),
      );
      setStatus('error');
    }
  };

  const elapsed = (now - startedAt.current) / 1000;
  const remaining =
    progress.progress > 0.02 ? (elapsed / progress.progress) * (1 - progress.progress) : NaN;

  if (status !== 'idle') {
    return (
      <div className="modal-backdrop">
        <div className="modal export-progress">
          {status === 'exporting' && (
            <>
              <h2>Exporting “{fileName}”</h2>
              <div className="big-percent">{Math.round(progress.progress * 100)}%</div>
              <div className="progress">
                <div className="progress-bar" style={{ width: `${progress.progress * 100}%` }} />
              </div>
              <div className="ex-stats">
                <div>
                  <span>Elapsed</span>
                  {fmtDuration(elapsed)}
                </div>
                <div>
                  <span>Remaining</span>
                  {fmtDuration(remaining)}
                </div>
                <div>
                  <span>Speed</span>
                  {progress.speed ? `${progress.speed.toFixed(1)}× real time` : '—'}
                </div>
                <div>
                  <span>Written</span>
                  {progress.size ? formatBytes(progress.size) : '—'}
                </div>
              </div>
              <div className="modal-actions">
                <button onClick={() => window.api.cancelExport()}>Cancel export</button>
              </div>
            </>
          )}
          {status === 'done' && (
            <>
              <div className="done-icon">✓</div>
              <h2>Export complete</h2>
              <div className="muted path-line" title={outPath}>
                {outPath}
              </div>
              <div className="muted">
                Finished in {fmtDuration((Date.now() - startedAt.current) / 1000)}
              </div>
              <div className="modal-actions center">
                <button onClick={() => setStatus('idle')}>Export another</button>
                {isAndroid ? (
                  <button className="primary" onClick={() => window.api.openFile(outPath)}>
                    Share / open video
                  </button>
                ) : (
                  <>
                    <button onClick={() => window.api.reveal(outPath)}>
                      {isMac ? 'Show in Finder' : 'Show in folder'}
                    </button>
                    <button className="primary" onClick={() => window.api.openFile(outPath)}>
                      Open video
                    </button>
                  </>
                )}
              </div>
              <div className="modal-actions center">
                <button className="link" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )}
          {(status === 'error' || status === 'cancelled') && (
            <>
              <h2>{status === 'error' ? 'Export failed' : 'Export cancelled'}</h2>
              {status === 'error' && <pre className="error">{error}</pre>}
              <div className="modal-actions">
                <button onClick={onClose}>Close</button>
                <button className="primary" onClick={() => setStatus('idle')}>
                  Back to settings
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal export-modal">
        <header className="ex-header">
          <h2>Export</h2>
          <button className="icon close" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="ex-body">
          <aside className="ex-side">
            <div className="ex-poster" style={{ aspectRatio: `${s.width} / ${s.height}` }}>
              {thumb && <img src={mediaUrl(thumb)} alt="" />}
              <span className="ex-poster-time">{formatTime(rangeLen)}</span>
            </div>
            <div className="ex-summary">
              <div>
                <span>Format</span>
                {format.label}
              </div>
              {hasVideo && (
                <div>
                  <span>Video</span>
                  {s.width}×{s.height} · {s.fps} fps
                </div>
              )}
              <div>
                <span>Audio</span>
                {s.audio && format.audio
                  ? format.audio === 'pcm'
                    ? `PCM ${s.sampleRate / 1000} kHz`
                    : `${s.audioBitrate} kbps`
                  : 'None'}
              </div>
              <div>
                <span>Duration</span>
                {formatTime(rangeLen)}
              </div>
              <div className="ex-size">
                <span>Estimated size</span>≈ {formatBytes(size)}
              </div>
            </div>
            <div className="ex-presets">
              <div className="ex-section-title">Presets</div>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`ex-preset ${preset === p.id ? 'active' : ''}`}
                  onClick={() => applyPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </aside>

          <div className="ex-main">
            <section>
              <div className="ex-section-title">File</div>
              <Row label="Name">
                <div className="name-field">
                  <input
                    value={s.name}
                    onChange={(e) => set({ name: e.target.value })}
                    spellCheck={false}
                  />
                  <span className="ext">.{format.ext}</span>
                </div>
              </Row>
              <Row label="Save to">
                <div className="folder-field">
                  <span className="folder-path" title={s.folder}>
                    {s.folder || '—'}
                  </span>
                  {!isAndroid && (
                    <button
                      onClick={async () => {
                        const f = await window.api.chooseFolder(s.folder);
                        if (f) set({ folder: f });
                      }}
                    >
                      Browse…
                    </button>
                  )}
                </div>
              </Row>
              <Row label="Format" hint={format.note}>
                <select value={s.format} onChange={(e) => set({ format: e.target.value })}>
                  <optgroup label="Video">
                    {FORMATS.filter((f) => f.video).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Audio only">
                    {FORMATS.filter((f) => !f.video).map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Row>
            </section>

            {hasVideo && (
              <section>
                <div className="ex-section-title">Video</div>
                <Row
                  label="Resolution"
                  hint={
                    aspectDiffers ? 'Different shape than the project: black bars are added.' : null
                  }
                >
                  <select
                    value={`${s.width}x${s.height}`}
                    onChange={(e) => {
                      const [w, h] = e.target.value.split('x').map(Number);
                      set({ width: w, height: h });
                    }}
                  >
                    {resolutions.map((r) => (
                      <option key={`${r.width}x${r.height}`} value={`${r.width}x${r.height}`}>
                        {r.label}
                        {r.width === project.settings.width && r.height === project.settings.height
                          ? ' (project)'
                          : ''}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Frame rate">
                  <select value={s.fps} onChange={(e) => set({ fps: +e.target.value })}>
                    {FRAME_RATES.map((f) => (
                      <option key={f} value={f}>
                        {f} fps{f === project.settings.fps ? ' (project)' : ''}
                      </option>
                    ))}
                  </select>
                </Row>
                {hwAvailable && (
                  <Row
                    label="Encoder"
                    hint={
                      s.hardware
                        ? 'Uses the Mac’s media engine: much faster, slightly larger files.'
                        : null
                    }
                  >
                    <Segmented
                      value={s.hardware ? 'hw' : 'sw'}
                      options={[
                        { id: 'sw', label: 'Software (best quality)' },
                        { id: 'hw', label: 'Hardware (fast)' },
                      ]}
                      onChange={(v) => set({ hardware: v === 'hw' })}
                    />
                  </Row>
                )}
                {usesRate && (
                  <Row label="Bitrate mode">
                    <Segmented
                      value={s.rateMode}
                      options={[
                        { id: 'crf', label: 'Constant quality' },
                        { id: 'vbr', label: 'VBR' },
                        { id: 'cbr', label: 'CBR' },
                      ]}
                      onChange={(v) => set({ rateMode: v })}
                    />
                  </Row>
                )}
                {usesQuality && (
                  <Row label={format.video === 'prores' ? 'ProRes flavor' : 'Quality'}>
                    <Segmented
                      value={s.quality}
                      options={QUALITY_LEVELS.map((q, i) => ({
                        id: q.id,
                        label:
                          format.video === 'prores' ? ['Proxy', 'LT', '422', 'HQ'][i] : q.label,
                      }))}
                      onChange={(v) => set({ quality: v })}
                    />
                  </Row>
                )}
                {usesRate && s.rateMode !== 'crf' && (
                  <Row label={s.rateMode === 'cbr' ? 'Bitrate' : 'Target bitrate'}>
                    <div className="bitrate-field">
                      <input
                        type="range"
                        min={500}
                        max={100000}
                        step={500}
                        value={s.bitrate}
                        onChange={(e) => set({ bitrate: +e.target.value })}
                      />
                      <input
                        type="number"
                        min={0.5}
                        max={200}
                        step={0.5}
                        value={+(s.bitrate / 1000).toFixed(1)}
                        onChange={(e) => set({ bitrate: Math.max(500, +e.target.value * 1000) })}
                      />
                      <span className="muted">Mbps</span>
                    </div>
                  </Row>
                )}
                {usesRate && !(s.hardware && hwAvailable) && (
                  <Row label="Encoding">
                    <Segmented
                      value={s.speed}
                      options={SPEEDS}
                      onChange={(v) => set({ speed: v })}
                    />
                  </Row>
                )}
              </section>
            )}

            {format.audio && (
              <section>
                <div className="ex-section-title">Audio</div>
                {hasVideo && (
                  <Row label="Include audio">
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={s.audio}
                        onChange={(e) => set({ audio: e.target.checked })}
                      />
                      <span />
                    </label>
                  </Row>
                )}
                {(s.audio || !hasVideo) && (
                  <>
                    {format.audio !== 'pcm' && (
                      <Row label="Bitrate">
                        <select
                          value={s.audioBitrate}
                          onChange={(e) => set({ audioBitrate: +e.target.value })}
                        >
                          {AUDIO_BITRATES.map((b) => (
                            <option key={b} value={b}>
                              {b} kbps
                            </option>
                          ))}
                        </select>
                      </Row>
                    )}
                    {format.audio !== 'opus' && (
                      <Row label="Sample rate">
                        <select
                          value={s.sampleRate}
                          onChange={(e) => set({ sampleRate: +e.target.value })}
                        >
                          {SAMPLE_RATES.map((r) => (
                            <option key={r} value={r}>
                              {(r / 1000).toFixed(1)} kHz
                            </option>
                          ))}
                        </select>
                      </Row>
                    )}
                    <Row label="Channels">
                      <Segmented
                        value={s.channels}
                        options={[
                          { id: 2, label: 'Stereo' },
                          { id: 1, label: 'Mono' },
                        ]}
                        onChange={(v) => set({ channels: v })}
                      />
                    </Row>
                  </>
                )}
              </section>
            )}

            <section>
              <div className="ex-section-title">Range</div>
              <Row label="Export">
                <Segmented
                  value={s.range}
                  options={[
                    { id: 'all', label: 'Entire timeline' },
                    { id: 'custom', label: 'Custom range' },
                  ]}
                  onChange={(v) => setSettings((cur) => ({ ...cur, range: v }))}
                />
              </Row>
              {s.range === 'custom' && (
                <Row label="From / to">
                  <div className="range-field">
                    <TimeInput
                      value={s.rangeStart}
                      max={duration}
                      onChange={(v) => setSettings((c) => ({ ...c, rangeStart: v }))}
                    />
                    <span className="muted">→</span>
                    <TimeInput
                      value={s.rangeEnd}
                      max={duration}
                      onChange={(v) => setSettings((c) => ({ ...c, rangeEnd: v }))}
                    />
                    <button
                      className="link"
                      onClick={() =>
                        setSettings((c) => ({ ...c, rangeStart: Math.min(time, c.rangeEnd) }))
                      }
                    >
                      Start at playhead
                    </button>
                  </div>
                </Row>
              )}
            </section>
          </div>
        </div>

        <footer className="ex-footer">
          <div className="ex-footer-info">
            {exists ? (
              <span className="warn">
                “{fileName}” already exists in this folder and will be replaced.
              </span>
            ) : (
              <span className="muted">
                {fileName} · ≈ {formatBytes(size)}
              </span>
            )}
          </div>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={start}
            disabled={!s.folder || rangeLen < 0.05 || !duration}
          >
            {exists ? 'Replace & Export' : 'Export'}
          </button>
        </footer>
      </div>
    </div>
  );
}
