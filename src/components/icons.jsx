// Stroke icons for the touch layout, drawn on a 24×24 grid.
const PATHS = {
  plus: 'M12 5v14M5 12h14',
  media:
    'M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5zM10 9.5v5l4-2.5z',
  audio: 'M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  overlay: 'M4 8h10v10H4zM10 4h10v10h-6',
  filter:
    'M12 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM8 10a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM16 10a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  transition: 'M3 5l9 7-9 7zM21 5l-9 7 9 7z',
  format: 'M7 3v14h14M3 7h14v14',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4M6 8h4M14 8h4M10 4v8a2 2 0 0 0 4 0V4',
  split:
    'M6 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6 15a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 8l12 10M8 16L20 6',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  adjust: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  speed: 'M12 20a8 8 0 1 1 8-8M12 12l4-4M4 12h1.5M12 4v1.5',
  volume: 'M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  eyeOff:
    'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.8M6.5 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
  animation: 'M12 3l2.2 5.3L20 9l-4.4 3.8L17 18.5 12 15.5 7 18.5l1.4-5.7L4 9l5.8-.7z',
  keyframe: 'M12 3l9 9-9 9-9-9z',
  detach:
    'M9 15l-2 2a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4 0M15 9l2-2a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4 0M4 4l3 3M20 20l-3-3',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  back: 'M15 5l-7 7 7 7',
  check: 'M5 12.5l4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h8V3M7 21v-7h10v7',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  start: 'M6 5v14M19 5L9 12l10 7z',
  track: 'M3 6h18M3 12h18M3 18h18',
};

export default function Icon({ name, size = 22, className = '' }) {
  return (
    <svg
      className={`icon-svg ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export function PlayIcon({ playing, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {playing ? (
        <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
      ) : (
        <path d="M8 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L9.2 4.5A.8.8 0 0 0 8 5.2z" />
      )}
    </svg>
  );
}
