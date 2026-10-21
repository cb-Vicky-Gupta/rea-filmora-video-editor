import { formatTime, type TrimRange } from '../time';

interface TimelineProps {
  duration: number;
  currentTime: number;
  trim: TrimRange;
  onTrimChange: (trim: TrimRange) => void;
  onSeek: (time: number) => void;
}

export function Timeline({ duration, currentTime, trim, onTrimChange, onSeek }: TimelineProps) {
  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const step = duration > 60 ? 0.1 : 0.01;

  return (
    <section className="panel timeline" aria-label="Timeline">
      <div className="panel-header">
        <h2>Timeline</h2>
        <span className="muted">Clip length: {formatTime(trim.end - trim.start)}</span>
      </div>

      <div
        className="track"
        role="presentation"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - rect.left) / rect.width) * duration);
        }}
      >
        <div
          className="track-selection"
          style={{ left: `${pct(trim.start)}%`, width: `${pct(trim.end - trim.start)}%` }}
        />
        <div className="playhead" style={{ left: `${pct(currentTime)}%` }} />
      </div>

      <div className="trim-controls">
        <label>
          In <output>{formatTime(trim.start)}</output>
          <input
            type="range"
            min={0}
            max={duration}
            step={step}
            value={trim.start}
            onChange={(e) => onTrimChange({ ...trim, start: Number(e.target.value) })}
          />
        </label>
        <label>
          Out <output>{formatTime(trim.end)}</output>
          <input
            type="range"
            min={0}
            max={duration}
            step={step}
            value={trim.end}
            onChange={(e) => onTrimChange({ ...trim, end: Number(e.target.value) })}
          />
        </label>
      </div>
    </section>
  );
}
