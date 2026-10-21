import type { Ref } from 'react';
import { formatTime } from '../time';
import type { Clip } from '../types';

interface PreviewProps {
  clip: Clip | null;
  videoRef: Ref<HTMLVideoElement>;
  playing: boolean;
  currentTime: number;
  onTogglePlay: () => void;
  onLoadedMetadata: (duration: number) => void;
  onTimeUpdate: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

export function Preview({
  clip,
  videoRef,
  playing,
  currentTime,
  onTogglePlay,
  onLoadedMetadata,
  onTimeUpdate,
  onPlayingChange,
}: PreviewProps) {
  return (
    <section className="panel preview" aria-label="Preview">
      <div className="screen">
        {clip ? (
          <video
            key={clip.id}
            ref={videoRef}
            src={clip.url}
            playsInline
            onLoadedMetadata={(e) => onLoadedMetadata(e.currentTarget.duration)}
            onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
            onPlay={() => onPlayingChange(true)}
            onPause={() => onPlayingChange(false)}
            onClick={onTogglePlay}
          />
        ) : (
          <p className="empty">Import a video to start editing.</p>
        )}
      </div>
      <div className="transport">
        <button type="button" onClick={onTogglePlay} disabled={!clip} aria-keyshortcuts="Space">
          {playing ? 'Pause' : 'Play'}
        </button>
        <span className="timecode">
          {formatTime(currentTime)} / {formatTime(clip?.duration ?? 0)}
        </span>
      </div>
    </section>
  );
}
