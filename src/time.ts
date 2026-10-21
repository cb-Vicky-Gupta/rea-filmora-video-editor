/** Minimum length (in seconds) a trimmed clip is allowed to have. */
export const MIN_CLIP_LENGTH = 0.1;

export interface TrimRange {
  start: number;
  end: number;
}

/**
 * Formats seconds as `mm:ss.cc` (or `h:mm:ss.cc` for long media).
 * Negative or non-finite values are treated as 0.
 */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalCentis = Math.floor(safe * 100 + 1e-6);
  const centis = totalCentis % 100;
  const totalSeconds = Math.floor(totalCentis / 100);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  const base = `${pad(m)}:${pad(s)}.${pad(centis)}`;
  return h > 0 ? `${h}:${base}` : base;
}

/**
 * Keeps a trim range inside `[0, duration]` and guarantees that
 * `end - start >= minLength` (when the media is long enough).
 */
export function clampTrim(
  range: TrimRange,
  duration: number,
  minLength = MIN_CLIP_LENGTH,
): TrimRange {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { start: 0, end: 0 };
  }
  const min = Math.min(minLength, duration);
  let start = Math.min(Math.max(range.start, 0), duration - min);
  let end = Math.min(Math.max(range.end, 0), duration);
  if (end - start < min) {
    end = Math.min(start + min, duration);
    start = end - min;
  }
  return { start, end };
}
