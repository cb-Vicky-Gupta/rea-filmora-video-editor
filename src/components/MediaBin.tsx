import { useRef } from 'react';
import { formatTime } from '../time';
import type { Clip } from '../types';

interface MediaBinProps {
  clips: Clip[];
  selectedId: string | null;
  onImport: (files: File[]) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaBin({ clips, selectedId, onImport, onSelect, onRemove }: MediaBinProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('video/'));
    if (files.length > 0) onImport(files);
  };

  return (
    <aside
      className="panel media-bin"
      aria-label="Media bin"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="panel-header">
        <h2>Media</h2>
        <button type="button" onClick={() => inputRef.current?.click()}>
          Import
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          multiple
          hidden
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {clips.length === 0 ? (
        <p className="empty">Drop video files here or click Import.</p>
      ) : (
        <ul className="clip-list">
          {clips.map((clip) => (
            <li key={clip.id} className={clip.id === selectedId ? 'selected' : undefined}>
              <button type="button" className="clip-name" onClick={() => onSelect(clip.id)}>
                <span>{clip.name}</span>
                <small>
                  {formatTime(clip.duration)} · {formatSize(clip.size)}
                </small>
              </button>
              <button
                type="button"
                className="icon"
                aria-label={`Remove ${clip.name}`}
                onClick={() => onRemove(clip.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
