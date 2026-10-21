import { describe, expect, it } from 'vitest';
import { DEFAULT_GRADE, bakeLut, makeGradeFn, parseCube, lutToCube } from './grade.mjs';
import {
  defaultSettings,
  encoderArgs,
  estimateSize,
  resolutionOptions,
  sanitizeFileName,
} from './export.mjs';
import { parseProbe } from './probe.mjs';
import { buildExportArgs } from './render.mjs';

const project = {
  settings: { width: 1920, height: 1080, fps: 30 },
  media: {
    a: { id: 'a', name: 'a.mp4', path: '/in/a.mp4', kind: 'video', hasAudio: true, duration: 5 },
    b: { id: 'b', name: 'b.png', path: '/in/b.png', kind: 'image', hasAudio: false, duration: 5 },
  },
  tracks: [
    {
      id: 'v2',
      kind: 'video',
      clips: [
        { id: 'o', mediaId: 'b', start: 1, in: 0, out: 2, volume: 1, transform: { scale: 0.3 } },
      ],
    },
    {
      id: 'v1',
      kind: 'video',
      clips: [
        { id: 'x', mediaId: 'a', start: 0, in: 0, out: 3, volume: 1, fadeIn: 0, fadeOut: 0 },
        {
          id: 'y',
          mediaId: 'a',
          start: 3,
          in: 1,
          out: 4,
          volume: 1,
          transition: { type: 'fade', duration: 1 },
        },
      ],
    },
    { id: 't1', kind: 'text', clips: [] },
    { id: 'a1', kind: 'audio', clips: [] },
  ],
};

function memoryIo() {
  const files = new Map();
  return {
    files,
    exists: (p) => p.startsWith('/in/'),
    readText: (p) => files.get(p),
    writeText: (p, t) => files.set(p, t),
    join: (...parts) => parts.join('/'),
    fonts: [],
    platform: 'linux',
  };
}

describe('export graph', () => {
  it('joins main-track clips with xfade and composites overlays', () => {
    const io = memoryIo();
    const { args, total } = buildExportArgs(project, '/out/v.mp4', '/tmp', {}, io);
    const graph = io.files.get('/tmp/graph.txt');
    expect(total).toBe(6);
    expect(graph).toContain('xfade=transition=fade:duration=1.000:offset=3.000');
    expect(graph).toContain('overlay=eof_action=pass');
    expect(graph).toContain('perspective=');
    expect(args).toContain('-filter_complex_script');
    expect(args.at(-1)).toBe('/out/v.mp4');
  });

  it('exports a custom range and audio-only formats', () => {
    const io = memoryIo();
    const { args, total } = buildExportArgs(
      project,
      '/out/a.mp3',
      '/tmp',
      { format: 'mp3', range: 'custom', rangeStart: 1, rangeEnd: 4 },
      io,
    );
    expect(total).toBe(3);
    expect(args).toEqual(expect.arrayContaining(['-ss', '1.000', '-c:a', 'libmp3lame']));
    expect(args).not.toContain('-c:v');
  });

  it('reports missing media files clearly', () => {
    const io = { ...memoryIo(), exists: () => false };
    expect(() => buildExportArgs(project, '/out/v.mp4', '/tmp', {}, io)).toThrow(
      /Media file not found/,
    );
  });
});

describe('export settings', () => {
  it('maps bitrate modes to encoder arguments', () => {
    const s = { ...defaultSettings(project), rateMode: 'cbr', bitrate: 4000 };
    expect(encoderArgs(s, 'linux')).toEqual(
      expect.arrayContaining(['-b:v', '4000k', '-x264-params', 'nal-hrd=cbr:force-cfr=1']),
    );
    expect(encoderArgs({ ...s, rateMode: 'crf', quality: 'best' }, 'linux')).toEqual(
      expect.arrayContaining(['-crf', '16']),
    );
    expect(encoderArgs({ ...s, hardware: true, rateMode: 'vbr' }, 'darwin')).toContain(
      'h264_videotoolbox',
    );
    expect(encoderArgs({ ...s, hardware: true }, 'win32')).toContain('libx264');
  });

  it('estimates size from the bitrate for VBR', () => {
    const s = { ...defaultSettings(project), rateMode: 'vbr', bitrate: 8000, audioBitrate: 192 };
    expect(estimateSize(s, 10)).toBe(((8000 + 192) * 1000 * 10) / 8);
  });

  it('keeps the project shape in resolution choices', () => {
    const vertical = { settings: { width: 1080, height: 1920 } };
    expect(resolutionOptions(vertical)[0]).toMatchObject({ width: 2160, height: 3840 });
    expect(resolutionOptions(project).map((r) => r.height)).toContain(720);
  });

  it('removes characters that file systems reject', () => {
    expect(sanitizeFileName('My: "best" video?.')).toBe('My best video');
    expect(sanitizeFileName('  ')).toBe('My Video');
  });
});

describe('color grading', () => {
  it('leaves colors unchanged with the default grade', () => {
    const fn = makeGradeFn(DEFAULT_GRADE, null);
    expect(fn(0.2, 0.5, 0.8).map((v) => +v.toFixed(5))).toEqual([0.2, 0.5, 0.8]);
  });

  it('turns colors grey at -100% saturation', () => {
    const [r, g, b] = makeGradeFn({ ...DEFAULT_GRADE, saturation: -1 }, null)(0.9, 0.2, 0.1);
    expect(r).toBeCloseTo(g);
    expect(g).toBeCloseTo(b);
  });

  it('round-trips a baked LUT through the .cube format', () => {
    const lut = bakeLut({ ...DEFAULT_GRADE, exposure: 0.5 }, null, 5);
    const parsed = parseCube(lutToCube(lut));
    expect(parsed.size).toBe(5);
    expect(parsed.data[parsed.data.length - 1]).toBeCloseTo(lut.data[lut.data.length - 1], 5);
    expect(() => parseCube('LUT_1D_SIZE 4')).toThrow(/1D/);
  });
});

describe('media probing', () => {
  const log = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mov':
  Duration: 00:00:12.50, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1920x1080, 4800 kb/s, 30 fps
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s`;

  it('reads kind, duration and rotated size', () => {
    expect(parseProbe(log, 'clip.mov', { hevcPlays: true })).toMatchObject({
      kind: 'video',
      duration: 12.5,
      width: 1080,
      height: 1920,
      hasAudio: true,
      needsProxy: false,
    });
  });

  it('asks for a preview proxy when the preview cannot decode the codec', () => {
    expect(parseProbe(log, 'clip.mov', { hevcPlays: false }).needsProxy).toBe(true);
    expect(
      parseProbe(log.replace('hevc', 'mpeg4'), 'clip.avi', { hevcPlays: true }).needsProxy,
    ).toBe(true);
  });

  it('rejects files without usable streams', () => {
    expect(() => parseProbe('Duration: N/A', 'notes.txt', { hevcPlays: true })).toThrow(
      /isn't a video/,
    );
  });
});
