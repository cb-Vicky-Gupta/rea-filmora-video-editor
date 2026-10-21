// Export settings: formats, presets and the ffmpeg encoder arguments they map to. Shared by the
// export dialog (choices, size estimate) and the exporter (arguments).

export const FORMATS = [
  { id: 'mp4-h264', label: 'MP4 · H.264', ext: 'mp4', video: 'h264', audio: 'aac', note: 'Plays everywhere' },
  { id: 'mp4-hevc', label: 'MP4 · H.265 / HEVC', ext: 'mp4', video: 'hevc', audio: 'aac', note: 'Smaller files, newer devices' },
  { id: 'mov-prores', label: 'MOV · Apple ProRes 422', ext: 'mov', video: 'prores', audio: 'pcm', note: 'Editing / mastering, very large' },
  { id: 'webm-vp9', label: 'WebM · VP9', ext: 'webm', video: 'vp9', audio: 'opus', note: 'For the web' },
  { id: 'gif', label: 'Animated GIF', ext: 'gif', video: 'gif', audio: null, note: 'No sound, short clips' },
  { id: 'mp3', label: 'MP3 (audio only)', ext: 'mp3', video: null, audio: 'mp3' },
  { id: 'm4a', label: 'M4A · AAC (audio only)', ext: 'm4a', video: null, audio: 'aac' },
  { id: 'wav', label: 'WAV (audio only)', ext: 'wav', video: null, audio: 'pcm' },
];
export const formatById = (id) => FORMATS.find((f) => f.id === id) || FORMATS[0];

// Quality levels for constant-quality encoding, as CRF values per codec.
export const QUALITY_LEVELS = [
  { id: 'low', label: 'Low', crf: { h264: 28, hevc: 30, vp9: 40 }, prores: 0 },
  { id: 'medium', label: 'Medium', crf: { h264: 23, hevc: 26, vp9: 34 }, prores: 1 },
  { id: 'high', label: 'High', crf: { h264: 19, hevc: 22, vp9: 30 }, prores: 2 },
  { id: 'best', label: 'Best', crf: { h264: 16, hevc: 18, vp9: 24 }, prores: 3 },
];

export const SPEEDS = [
  { id: 'fast', label: 'Faster', x264: 'veryfast', vp9: 5 },
  { id: 'balanced', label: 'Balanced', x264: 'medium', vp9: 3 },
  { id: 'small', label: 'Smaller file', x264: 'slow', vp9: 1 },
];

export const FRAME_RATES = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
export const AUDIO_BITRATES = [96, 128, 192, 256, 320];
export const SAMPLE_RATES = [44100, 48000];

// Resolution choices keep the project's aspect ratio, by height of the shorter side.
const SIZES = [2160, 1440, 1080, 720, 540, 480, 360];
export function resolutionOptions(project) {
  const { width, height } = project.settings;
  const landscape = width >= height;
  const ratio = landscape ? width / height : height / width;
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const seen = new Set();
  const out = [];
  for (const s of SIZES) {
    const long = even(s * ratio);
    const [w, h] = landscape ? [long, s] : [s, long];
    const key = `${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = s === 2160 ? '4K' : s === 1440 ? '2K' : `${s}p`;
    out.push({ width: w, height: h, label: `${name} · ${w}×${h}` });
  }
  return out;
}

// One-click presets (like Filmora's / Premiere's "Match source", "YouTube", ...).
export const PRESETS = [
  { id: 'project', label: 'Match project', settings: {} },
  { id: 'youtube-1080', label: 'YouTube 1080p', settings: { format: 'mp4-h264', width: 1920, height: 1080, rateMode: 'vbr', bitrate: 12000, audioBitrate: 320 } },
  { id: 'youtube-4k', label: 'YouTube 4K', settings: { format: 'mp4-h264', width: 3840, height: 2160, rateMode: 'vbr', bitrate: 45000, audioBitrate: 320 } },
  { id: 'reels', label: 'Instagram Reels / TikTok', settings: { format: 'mp4-h264', width: 1080, height: 1920, fps: 30, rateMode: 'vbr', bitrate: 8000, audioBitrate: 192 } },
  { id: 'instagram-square', label: 'Instagram Feed (square)', settings: { format: 'mp4-h264', width: 1080, height: 1080, fps: 30, rateMode: 'vbr', bitrate: 6000, audioBitrate: 192 } },
  { id: 'x', label: 'X / Twitter 720p', settings: { format: 'mp4-h264', width: 1280, height: 720, fps: 30, rateMode: 'vbr', bitrate: 5000, audioBitrate: 128 } },
  { id: 'web-small', label: 'Small file (email, chat)', settings: { format: 'mp4-h264', width: 1280, height: 720, rateMode: 'crf', quality: 'low', audioBitrate: 128 } },
  { id: 'master', label: 'Master (ProRes)', settings: { format: 'mov-prores', quality: 'high' } },
];

export function defaultSettings(project) {
  return {
    name: 'My Video',
    folder: '',
    format: 'mp4-h264',
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    rateMode: 'crf', // crf | vbr | cbr
    quality: 'high',
    bitrate: 12000, // kbps
    speed: 'balanced',
    hardware: false,
    audio: true,
    audioBitrate: 192,
    sampleRate: 48000,
    channels: 2,
    range: 'all', // all | custom
    rangeStart: 0,
    rangeEnd: 0,
  };
}

// Typical H.264 bits per pixel at each quality level, used for size estimates.
const BPP = { low: 0.035, medium: 0.06, high: 0.09, best: 0.14 };
const CODEC_EFFICIENCY = { h264: 1, hevc: 0.6, vp9: 0.65 };
const PRORES_MBPS_1080P30 = [45, 102, 147, 220]; // proxy, LT, 422, HQ

// Estimated output size in bytes.
export function estimateSize(s, duration) {
  const f = formatById(s.format);
  let videoKbps = 0;
  if (f.video === 'prores') {
    const level = QUALITY_LEVELS.findIndex((q) => q.id === s.quality);
    videoKbps = PRORES_MBPS_1080P30[Math.max(0, level)] * 1000 * ((s.width * s.height) / (1920 * 1080)) * (s.fps / 30);
  } else if (f.video === 'gif') {
    videoKbps = (Math.min(s.width, 640) * Math.min(s.height, 640) * Math.min(s.fps, 15) * 0.4) / 1000;
  } else if (f.video) {
    videoKbps =
      s.rateMode === 'crf' && !s.hardware
        ? (s.width * s.height * s.fps * BPP[s.quality] * CODEC_EFFICIENCY[f.video]) / 1000
        : s.bitrate;
  }
  let audioKbps = 0;
  if (s.audio && f.audio) audioKbps = f.audio === 'pcm' ? (s.sampleRate * 16 * s.channels) / 1000 : s.audioBitrate;
  return ((videoKbps + audioKbps) * 1000 * duration) / 8;
}

export function formatBytes(b) {
  if (b < 1e6) return `${Math.max(1, Math.round(b / 1e3))} KB`;
  if (b < 1e9) return `${(b / 1e6).toFixed(b < 1e8 ? 1 : 0)} MB`;
  return `${(b / 1e9).toFixed(2)} GB`;
}

const FORBIDDEN = /[<>:"/\\|?*\x00-\x1f]/g;
export const sanitizeFileName = (name) => name.replace(FORBIDDEN, '').trim().replace(/\.+$/, '') || 'My Video';

// ffmpeg output arguments (codecs and rate control) for the chosen settings.
export function encoderArgs(s, platform) {
  const f = formatById(s.format);
  const args = [];
  const kbps = (v) => `${Math.round(v)}k`;
  const q = QUALITY_LEVELS.find((l) => l.id === s.quality) || QUALITY_LEVELS[2];
  const speed = SPEEDS.find((p) => p.id === s.speed) || SPEEDS[1];
  const hw = s.hardware && platform === 'darwin' && (f.video === 'h264' || f.video === 'hevc');

  const rate = () => {
    if (s.rateMode === 'cbr') return ['-b:v', kbps(s.bitrate), '-minrate', kbps(s.bitrate), '-maxrate', kbps(s.bitrate), '-bufsize', kbps(s.bitrate)];
    return ['-b:v', kbps(s.bitrate), '-maxrate', kbps(s.bitrate * 1.5), '-bufsize', kbps(s.bitrate * 2)];
  };

  switch (f.video) {
    case 'h264':
      if (hw) args.push('-c:v', 'h264_videotoolbox', '-profile:v', 'high', ...(s.rateMode === 'crf' ? ['-q:v', String(40 + q.prores * 15)] : rate()));
      else args.push('-c:v', 'libx264', '-preset', speed.x264, '-profile:v', 'high', ...(s.rateMode === 'crf' ? ['-crf', String(q.crf.h264)] : rate()));
      // True constant bitrate needs x264's HRD signalling (it pads to the target rate).
      if (!hw && s.rateMode === 'cbr') args.push('-x264-params', 'nal-hrd=cbr:force-cfr=1');
      args.push('-pix_fmt', 'yuv420p');
      break;
    case 'hevc':
      if (hw) args.push('-c:v', 'hevc_videotoolbox', ...(s.rateMode === 'crf' ? ['-q:v', String(40 + q.prores * 15)] : rate()));
      else args.push('-c:v', 'libx265', '-preset', speed.x264, ...(s.rateMode === 'crf' ? ['-crf', String(q.crf.hevc)] : rate()));
      args.push('-tag:v', 'hvc1', '-pix_fmt', 'yuv420p');
      break;
    case 'prores':
      args.push('-c:v', 'prores_ks', '-profile:v', String(q.prores), '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le');
      break;
    case 'vp9':
      args.push('-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', String(speed.vp9));
      args.push(...(s.rateMode === 'crf' ? ['-crf', String(q.crf.vp9), '-b:v', '0'] : rate()), '-pix_fmt', 'yuv420p');
      break;
    case 'gif':
      args.push('-c:v', 'gif', '-loop', '0');
      break;
  }

  if (s.audio && f.audio) {
    const sampleRate = f.audio === 'opus' ? 48000 : s.sampleRate;
    if (f.audio === 'aac') args.push('-c:a', 'aac', '-b:a', `${s.audioBitrate}k`);
    if (f.audio === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', `${s.audioBitrate}k`);
    if (f.audio === 'opus') args.push('-c:a', 'libopus', '-b:a', `${s.audioBitrate}k`);
    if (f.audio === 'pcm') args.push('-c:a', 'pcm_s16le');
    args.push('-ar', String(sampleRate), '-ac', String(s.channels));
  }
  if (f.ext === 'mp4' || f.ext === 'mov' || f.ext === 'm4a') args.push('-movflags', '+faststart');
  return args;
}
