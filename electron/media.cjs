// Media import: probing, thumbnails, waveforms, and conversions so every file can be previewed.
//
// The preview plays media in Chromium, which decodes fewer formats than ffmpeg. Files Chromium
// can't play get an H.264/AAC "proxy" used only for preview; exports always read the original.
// Photos Chromium can't show (HEIC, TIFF...) are converted to a still image used for both.
const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  IMAGE_EXT,
  BROWSER_IMAGE_EXT,
  AUDIO_EXT,
  parseProbe,
  thumbArgs,
  waveformArgs,
  proxyArgs,
} = require('../shared/probe.mjs');

function createMediaTools({ ffmpegPath, cacheDir, allow }) {
  fs.mkdirSync(cacheDir, { recursive: true });

  const run = (args) =>
    new Promise((resolve) => {
      execFile(ffmpegPath, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) =>
        resolve({ err, stderr }),
      );
    });

  // Cache files are keyed by the source's path, size and modification time.
  const cacheKey = (filePath) => {
    const st = fs.statSync(filePath);
    return crypto
      .createHash('sha1')
      .update(`${filePath}|${st.size}|${st.mtimeMs}`)
      .digest('hex')
      .slice(0, 20);
  };
  const cached = (key, suffix) => path.join(cacheDir, `${key}${suffix}`);

  async function convertImage(filePath, key) {
    const out = cached(key, '.png');
    if (fs.existsSync(out)) return out;
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.heic' || ext === '.heif') {
      if (process.platform !== 'darwin') {
        throw new Error(
          `${path.basename(filePath)}: HEIC photos can't be read on Windows. Convert it to JPG first.`,
        );
      }
      await new Promise((resolve) =>
        execFile('sips', ['-s', 'format', 'png', filePath, '--out', out], () => resolve()),
      );
    } else {
      await run(['-hide_banner', '-y', '-i', filePath, '-frames:v', '1', out]);
    }
    if (!fs.existsSync(out)) throw new Error(`Can't read image: ${path.basename(filePath)}`);
    return out;
  }

  async function makeThumb(media) {
    const out = cached(media.key, '-thumb.jpg');
    if (!fs.existsSync(out)) {
      await run(['-hide_banner', '-y', ...thumbArgs(media.path, out, media.kind, media.duration)]);
    }
    return fs.existsSync(out) ? out : null;
  }

  async function makeWaveform(media) {
    const out = cached(media.key, '-wave.png');
    if (!fs.existsSync(out)) {
      await run(['-hide_banner', '-y', ...waveformArgs(media.path, out)]);
    }
    return fs.existsSync(out) ? out : null;
  }

  async function makeProxy(media) {
    const out = cached(media.key, media.kind === 'audio' ? '-proxy.m4a' : '-proxy.mp4');
    if (fs.existsSync(out)) return out;
    const tmp = out + '.part' + path.extname(out);
    const args = ['-hide_banner', '-y', ...proxyArgs(media.path, tmp, media.kind)];
    const { err, stderr } = await run(args);
    if (err || !fs.existsSync(tmp)) {
      throw new Error(
        `Can't convert ${media.name} for preview: ${stderr.split('\n').filter(Boolean).pop()}`,
      );
    }
    fs.renameSync(tmp, out);
    return out;
  }

  // Creates (or re-creates, for a reopened project) the cached helper files of a media item.
  async function ensureAssets(media) {
    if (!fs.existsSync(media.originalPath || media.path)) return { ...media, missing: true };
    const m = { ...media, missing: false };
    m.key ??= cacheKey(m.originalPath || m.path);
    if (m.originalPath && !fs.existsSync(m.path))
      m.path = await convertImage(m.originalPath, m.key);
    if (m.kind !== 'audio') m.thumb = await makeThumb(m);
    if (m.hasAudio) m.waveform = await makeWaveform(m);
    if (m.needsProxy) m.proxy = await makeProxy(m);
    for (const p of [m.path, m.originalPath, m.thumb, m.waveform, m.proxy]) if (p) allow(p);
    return m;
  }

  async function probe(filePath) {
    const name = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const key = cacheKey(filePath);
    const isImage = IMAGE_EXT.has(ext);

    let readPath = filePath;
    let originalPath;
    if (isImage && !BROWSER_IMAGE_EXT.has(ext)) {
      readPath = await convertImage(filePath, key);
      originalPath = filePath;
    }

    const { stderr } = await run(['-hide_banner', '-i', readPath]);
    // Chromium decodes HEVC on macOS; on Windows it depends on an optional system extension.
    const info = parseProbe(stderr, name, { hevcPlays: process.platform === 'darwin' });

    const media = await ensureAssets({
      id: crypto.randomUUID(),
      key,
      path: readPath,
      originalPath,
      name,
      ...info,
      thumb: null,
      waveform: null,
      proxy: null,
    });
    if (info.kind !== 'audio' && !media.thumb) throw new Error(`Can't decode ${name}.`);
    return media;
  }

  return { probe, ensureAssets };
}

module.exports = { createMediaTools, IMAGE_EXT, AUDIO_EXT };
