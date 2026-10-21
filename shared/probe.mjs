// Media probing rules shared by the desktop importer (native ffmpeg) and the Android importer
// (ffmpeg.wasm): both parse the output of `ffmpeg -i <file>`.

export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.heif', '.tif', '.tiff']);
export const BROWSER_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
export const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.aiff', '.aif', '.wma', '.ac3']);
export const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mts', 'm2ts', 'ts', '3gp', 'mpg', 'mpeg', 'ogv'];

const BROWSER_VIDEO_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.3gp']);
const BROWSER_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const BROWSER_AUDIO_FILES = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus']);

export const extOf = (name) => {
  const m = /\.[^./\\]+$/.exec(name);
  return m ? m[0].toLowerCase() : '';
};

// Parses `ffmpeg -i` output. `hevcPlays` says whether the preview can decode HEVC.
export function parseProbe(stderr, name, { hevcPlays }) {
  const ext = extOf(name);
  const lines = stderr.split('\n');
  const videoLine = lines.find((l) => /Stream #.*Video:/.test(l) && !/attached pic/.test(l));
  const audioLine = lines.find((l) => /Stream #.*Audio:/.test(l));
  const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  const size = videoLine && /, (\d{2,5})x(\d{2,5})/.exec(videoLine);
  const rotation = +(/displaymatrix: rotation of (-?[\d.]+) degrees/.exec(stderr)?.[1] || 0);
  const vcodec = videoLine && /Video: (\w+)/.exec(videoLine)[1];
  const acodec = audioLine && /Audio: (\w+)/.exec(audioLine)[1];

  let kind;
  if (IMAGE_EXT.has(ext)) kind = 'image';
  else if (AUDIO_EXT.has(ext) || (!videoLine && audioLine)) kind = 'audio';
  else if (videoLine) kind = 'video';
  else throw new Error(`${name} isn't a video, audio or image file ReaCut can read.`);

  if (kind === 'image' && !videoLine) throw new Error(`Can't read image: ${name}`);
  if (kind === 'audio' && !audioLine) throw new Error(`${name} has no audio.`);
  const duration = kind === 'image' ? 5 : dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0;
  if (kind !== 'image' && !(duration > 0)) throw new Error(`${name} has no readable duration.`);

  let width = size ? +size[1] : 0;
  let height = size ? +size[2] : 0;
  if (Math.abs(Math.abs(rotation) - 90) < 1) [width, height] = [height, width];

  const videoCodecs = new Set(['h264', 'vp8', 'vp9', 'av1', ...(hevcPlays ? ['hevc'] : [])]);
  let needsProxy = false;
  if (kind === 'video') {
    needsProxy =
      !BROWSER_VIDEO_CONTAINERS.has(ext) || !videoCodecs.has(vcodec) || (!!acodec && !BROWSER_AUDIO_CODECS.has(acodec));
  } else if (kind === 'audio') {
    const pcmWav = ext === '.wav' && /^pcm_/.test(acodec);
    needsProxy = !BROWSER_AUDIO_FILES.has(ext) || !(BROWSER_AUDIO_CODECS.has(acodec) || pcmWav);
  }

  return { kind, duration, width, height, hasAudio: kind !== 'image' && !!audioLine, needsProxy };
}

// ffmpeg arguments for helper files (paths are filled in by the caller).
export const thumbArgs = (input, output, kind, duration) => [
  ...(kind === 'video' ? ['-ss', String(Math.min(1, duration / 2))] : []),
  '-i', input, '-frames:v', '1', '-vf', 'scale=320:-2', output,
];
export const waveformArgs = (input, output) => [
  '-i', input,
  '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=2000x120:colors=0x9be7c4',
  '-frames:v', '1', output,
];
export const proxyArgs = (input, output, kind) =>
  kind === 'audio'
    ? ['-i', input, '-vn', '-c:a', 'aac', '-b:a', '192k', output]
    : [
        '-i', input, '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-pix_fmt', 'yuv420p',
        '-vf', "scale='trunc(min(1280,iw)/2)*2':-2",
        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output,
      ];
