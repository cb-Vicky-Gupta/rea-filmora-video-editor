import { useCallback, useEffect, useRef, useState } from 'react';
import { MediaBin } from './components/MediaBin';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { canExport, exportClip } from './exportClip';
import { clampTrim, type TrimRange } from './time';
import type { Clip } from './types';

function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => resolve(video.duration);
    video.onerror = () => resolve(0);
    video.src = url;
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const selected = clips.find((c) => c.id === selectedId) ?? null;

  // Release object URLs when the app unmounts.
  const clipsRef = useRef(clips);
  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);
  useEffect(() => () => clipsRef.current.forEach((c) => URL.revokeObjectURL(c.url)), []);

  const handleImport = async (files: File[]) => {
    const imported = await Promise.all(
      files.map(async (file): Promise<Clip> => {
        const url = URL.createObjectURL(file);
        const duration = await probeDuration(url);
        return {
          id: crypto.randomUUID(),
          name: file.name,
          url,
          size: file.size,
          duration,
          trim: { start: 0, end: duration },
        };
      }),
    );
    setClips((prev) => [...prev, ...imported]);
    if (!selectedId && imported[0]) setSelectedId(imported[0].id);
  };

  const handleRemove = (id: string) => {
    setClips((prev) => {
      const clip = prev.find((c) => c.id === id);
      if (clip) URL.revokeObjectURL(clip.url);
      return prev.filter((c) => c.id !== id);
    });
    if (id === selectedId) {
      setSelectedId(null);
      setCurrentTime(0);
      setPlaying(false);
    }
  };

  const updateTrim = (trim: TrimRange) => {
    if (!selected) return;
    const next = clampTrim(trim, selected.duration);
    setClips((prev) => prev.map((c) => (c.id === selected.id ? { ...c, trim: next } : c)));
  };

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (video) video.currentTime = time;
    setCurrentTime(time);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !selected) return;
    if (video.paused) {
      // Restart from the in-point when outside the trimmed range.
      if (video.currentTime < selected.trim.start || video.currentTime >= selected.trim.end) {
        video.currentTime = selected.trim.start;
      }
      void video.play();
    } else {
      video.pause();
    }
  }, [selected]);

  const handleTimeUpdate = (time: number) => {
    setCurrentTime(time);
    const video = videoRef.current;
    if (video && selected && !video.paused && time >= selected.trim.end) {
      video.pause();
      video.currentTime = selected.trim.end;
    }
  };

  // Space bar toggles playback (unless typing in a form control).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.code !== 'Space' || ['INPUT', 'BUTTON', 'TEXTAREA'].includes(target.tagName)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  const handleExport = async () => {
    if (!selected) return;
    setError(null);
    setExportProgress(0);
    try {
      const blob = await exportClip(selected.url, selected.trim, setExportProgress);
      const base = selected.name.replace(/\.[^.]+$/, '');
      downloadBlob(blob, `${base}-trimmed.webm`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExportProgress(null);
    }
  };

  const exporting = exportProgress !== null;

  return (
    <div className="app">
      <header className="topbar">
        <h1>Rea Video Editor</h1>
        <div className="actions">
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
          <button
            type="button"
            className="primary"
            onClick={handleExport}
            disabled={!selected || exporting || !canExport()}
            title={
              canExport()
                ? 'Export the trimmed clip as WebM'
                : 'Export is not supported in this browser'
            }
          >
            {exporting ? `Exporting… ${Math.round((exportProgress ?? 0) * 100)}%` : 'Export'}
          </button>
        </div>
      </header>

      <main className="workspace">
        <MediaBin
          clips={clips}
          selectedId={selectedId}
          onImport={handleImport}
          onSelect={(id) => {
            setSelectedId(id);
            setCurrentTime(0);
            setPlaying(false);
          }}
          onRemove={handleRemove}
        />
        <Preview
          clip={selected}
          videoRef={videoRef}
          playing={playing}
          currentTime={currentTime}
          onTogglePlay={togglePlay}
          onLoadedMetadata={() => selected && seek(selected.trim.start)}
          onTimeUpdate={handleTimeUpdate}
          onPlayingChange={setPlaying}
        />
      </main>

      {selected && (
        <Timeline
          duration={selected.duration}
          currentTime={currentTime}
          trim={selected.trim}
          onTrimChange={updateTrim}
          onSeek={seek}
        />
      )}
    </div>
  );
}
