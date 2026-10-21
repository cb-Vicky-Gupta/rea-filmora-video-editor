import type { TrimRange } from './time';

/** A video file the user imported into the media bin. */
export interface Clip {
  id: string;
  name: string;
  /** Object URL created with `URL.createObjectURL`. */
  url: string;
  size: number;
  /** Duration in seconds, known once metadata has loaded. */
  duration: number;
  trim: TrimRange;
}
