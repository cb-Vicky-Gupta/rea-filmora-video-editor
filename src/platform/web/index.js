// `window.api` for Android (and plain browsers): the same interface the Electron preload
// provides, implemented in the WebView. ffmpeg runs as WebAssembly; imported files are mounted
// into its file system (WORKERFS) without copying, and exports go to Documents/ReaCut.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import fontURL from './assets/Roboto-Bold.ttf?url';
import { buildExportArgs } from '../../../shared/render.mjs';
import {
  BROWSER_IMAGE_EXT,
  extOf,
  parseProbe,
  proxyArgs,
  thumbArgs,
  waveformArgs,
} from '../../../shared/probe.mjs';

const EXPORT_DIR = 'ReaCut';
const FONT_PATH = '/fonts/Roboto-Bold.ttf';
const native = Capacitor.isNativePlatform();

// ---------------- ffmpeg.wasm engine ----------------

let engine = null; // { ff, mounted: Set<mediaId> }
let loading = null;

async function getEngine() {
  if (engine) return engine;
  loading ??= (async () => {
    const ff = new FFmpeg();
    await ff.load({ coreURL, wasmURL });
    // Some of these (like /tmp) already exist in ffmpeg.wasm's file system.
    for (const dir of ['/in', '/tmp', '/out', '/fonts']) await ff.createDir(dir).catch(() => {});
    await ff.writeFile(FONT_PATH, new Uint8Array(await (await fetch(fontURL)).arrayBuffer()));
    engine = { ff, mounted: new Set() };
    return engine;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

function resetEngine() {
  engine?.ff.terminate();
  engine = null;
}

// Imported files by media id; they stay available for the rest of the session.
const files = new Map();
const urls = new Map(); // virtual path -> object URL
const luts = new Map(); // virtual path -> .cube text

const virtualPath = (id, name) => `/in/${id}/${name}`;

async function mount(eng, id) {
  if (eng.mounted.has(id)) return;
  const file = files.get(id);
  if (!file) throw new Error('This media is no longer available. Import it again.');
  await eng.ff.createDir(`/in/${id}`);
  await eng.ff.mount('WORKERFS', { files: [file] }, `/in/${id}`);
  eng.mounted.add(id);
}

async function run(eng, args, onLine) {
  const lines = [];
  const handler = ({ message }) => {
    lines.push(message);
    onLine?.(message);
  };
  eng.ff.on('log', handler);
  try {
    const code = await eng.ff.exec(['-hide_banner', ...args]);
    return { code, log: lines.join('\n') };
  } finally {
    eng.ff.off('log', handler);
  }
}

// Runs ffmpeg into a temporary output and returns the result as a Blob (or null).
async function produce(eng, args, outName, type) {
  const out = `/tmp/${outName}`;
  await run(eng, [...args.slice(0, -1), out]);
  try {
    const data = await eng.ff.readFile(out);
    await eng.ff.deleteFile(out);
    return new Blob([data], { type });
  } catch {
    return null;
  }
}

function register(path, blob) {
  const url = URL.createObjectURL(blob);
  urls.set(path, url);
  return path;
}

// ---------------- Files in and out ----------------

function pickFiles(accept, multiple) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve([...input.files]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

function toBase64(bytes, start, end) {
  let bin = '';
  for (let i = start; i < end; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + 0x8000)));
  return btoa(bin);
}

// Writes bytes to Documents/ReaCut/<name>, in chunks so large videos don't exhaust memory.
async function saveToDocuments(name, bytes) {
  const path = `${EXPORT_DIR}/${name}`;
  if (!native) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = name;
    a.click();
    return path;
  }
  const CHUNK = 3 * 1024 * 1024; // multiple of 3, so base64 chunks concatenate cleanly
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const data = toBase64(bytes, i, Math.min(bytes.length, i + CHUNK));
    if (i === 0)
      await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Documents });
  }
  return (await Filesystem.getUri({ path, directory: Directory.Documents })).uri;
}

async function shareFile(uri) {
  if (native) await Share.share({ title: 'ReaCut video', files: [uri] });
}

// ---------------- Import ----------------

const hevcPlays = () =>
  !!document.createElement('video').canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"');

async function probeFile(file) {
  const eng = await getEngine();
  const id = crypto.randomUUID();
  const ext = extOf(file.name);
  let source = file;
  if (/^\.(heic|heif)$/.test(ext))
    throw new Error(
      `${file.name}: HEIC photos can't be read here. Share it as JPG and import that.`,
    );

  files.set(id, source);
  await mount(eng, id);
  let path = virtualPath(id, source.name);

  // Images the WebView can't show (TIFF…) are converted to PNG once.
  if ((ext === '.tif' || ext === '.tiff') && !BROWSER_IMAGE_EXT.has(ext)) {
    const png = await produce(
      eng,
      ['-i', path, '-frames:v', '1', 'x.png'],
      `${id}.png`,
      'image/png',
    );
    if (!png) throw new Error(`Can't read image: ${file.name}`);
    source = new File([png], file.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' });
    const pngId = crypto.randomUUID();
    files.set(pngId, source);
    await mount(eng, pngId);
    path = virtualPath(pngId, source.name);
  }

  const { log } = await run(eng, ['-i', path]);
  const info = parseProbe(log, file.name, { hevcPlays: hevcPlays() });
  const media = {
    id,
    key: id,
    path,
    name: file.name,
    ...info,
    thumb: null,
    waveform: null,
    proxy: null,
  };
  register(path, source);

  if (info.kind !== 'audio') {
    const thumb = await produce(
      eng,
      thumbArgs(path, 'x', info.kind, info.duration),
      `${id}-thumb.jpg`,
      'image/jpeg',
    );
    if (!thumb) throw new Error(`Can't decode ${file.name}.`);
    media.thumb = register(`/cache/${id}-thumb.jpg`, thumb);
  }
  if (info.hasAudio) {
    const wave = await produce(eng, waveformArgs(path, 'x'), `${id}-wave.png`, 'image/png');
    if (wave) media.waveform = register(`/cache/${id}-wave.png`, wave);
  }
  if (info.needsProxy) {
    const ext2 = info.kind === 'audio' ? 'm4a' : 'mp4';
    const proxy = await produce(
      eng,
      proxyArgs(path, 'x', info.kind),
      `${id}-proxy.${ext2}`,
      info.kind === 'audio' ? 'audio/mp4' : 'video/mp4',
    );
    if (!proxy) throw new Error(`Can't convert ${file.name} for preview.`);
    media.proxy = register(`/cache/${id}-proxy.${ext2}`, proxy);
  }
  return media;
}

async function probeMany(list) {
  const results = [];
  for (const file of list) {
    try {
      results.push(await probeFile(file));
    } catch (e) {
      results.push({ error: String(e.message || e), path: file.name });
    }
  }
  return results;
}

// ---------------- Export ----------------

const progressListeners = new Set();
let cancelled = false;
let exporting = false;

function parseClock(s) {
  const m = /(\d+):(\d+):([\d.]+)/.exec(s);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

async function startExport(project, outPath, settings) {
  if (exporting) throw new Error('An export is already running.');
  exporting = true;
  cancelled = false;
  try {
    const eng = await getEngine();
    const used = new Set(
      project.tracks.flatMap((t) => t.clips.map((c) => c.mediaId)).filter(Boolean),
    );
    for (const id of used) {
      const m = project.media[id];
      if (m && !m.missing) await mount(eng, m.path.split('/')[2]);
    }
    const name = outPath.split(/[\\/]/).pop();
    const jobDir = `/tmp/job-${Date.now()}`;
    await eng.ff.createDir(jobDir);
    const pending = new Map();
    const known = new Set(
      Object.values(project.media)
        .filter((m) => !m.missing)
        .map((m) => m.path),
    );
    const io = {
      exists: (p) => p === FONT_PATH || known.has(p),
      readText: (p) => {
        if (!luts.has(p)) throw new Error('LUT file is no longer available. Import it again.');
        return luts.get(p);
      },
      writeText: (p, text) => pending.set(p, text),
      join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
      fonts: [FONT_PATH],
      platform: 'android',
    };
    const out = `/out/${name}`;
    const { args, total } = buildExportArgs(
      project,
      out,
      jobDir,
      { ...settings, hardware: false },
      io,
    );
    for (const [p, text] of pending) await eng.ff.writeFile(p, text);

    // ffmpeg.wasm has no pipe for -progress; read the regular stats lines instead.
    const cleaned = args.filter(
      (a, i) =>
        !['-progress', 'pipe:1', '-nostats', '-hide_banner'].includes(a) &&
        args[i - 1] !== '-progress',
    );
    const started = performance.now();
    let size = 0;
    const { code, log } = await run(eng, cleaned, (line) => {
      const t = /time=(\S+)/.exec(line);
      if (!t) return;
      size = +(/size=\s*(\d+)\s*[kK]i?B/.exec(line)?.[1] || size / 1024) * 1024;
      const done = Math.min(1, parseClock(t[1]) / total);
      const speed =
        parseFloat(/speed=\s*([\d.]+)x/.exec(line)?.[1]) ||
        parseClock(t[1]) / ((performance.now() - started) / 1000);
      for (const cb of progressListeners)
        cb({ progress: done, fps: +(/fps=\s*([\d.]+)/.exec(line)?.[1] || 0), speed, size });
    });
    if (cancelled) return { ok: false, cancelled: true };
    if (code !== 0) throw new Error(log.split('\n').filter(Boolean).slice(-6).join('\n'));
    const bytes = await eng.ff.readFile(out);
    await eng.ff.deleteFile(out);
    for (const p of pending.keys()) await eng.ff.deleteFile(p).catch(() => {});
    const uri = await saveToDocuments(name, bytes);
    return { ok: true, path: uri };
  } catch (e) {
    if (cancelled) return { ok: false, cancelled: true };
    throw e;
  } finally {
    exporting = false;
  }
}

// ---------------- Projects ----------------

async function saveProject(project) {
  const name = `ReaCut project ${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.reacut`;
  const bytes = new TextEncoder().encode(JSON.stringify(project, null, 2));
  const uri = await saveToDocuments(name, bytes);
  return native ? `Documents/${EXPORT_DIR}/${name}` : uri;
}

async function openProject() {
  const [file] = await pickFiles('.reacut,application/json', false);
  if (!file) return null;
  const project = JSON.parse(await file.text());
  // Media only stays available within the session it was imported in.
  for (const m of Object.values(project.media || {})) {
    const id = m.path?.split('/')[2];
    m.missing = !files.has(id);
  }
  return project;
}

export function install() {
  window.api = {
    platform: 'android',
    mediaUrl: (p) => urls.get(p) || '',
    importMedia: async () => probeMany(await pickFiles('video/*,audio/*,image/*', true)),
    probeFiles: (list) => probeMany(list),
    importLut: async () => {
      const [file] = await pickFiles('.cube', false);
      if (!file) return null;
      const path = `/luts/${crypto.randomUUID()}/${file.name}`;
      luts.set(path, await file.text());
      return { path, name: file.name.replace(/\.cube$/i, '') };
    },
    readLut: async (p) => {
      if (!luts.has(p)) throw new Error('LUT not available');
      return luts.get(p);
    },
    saveProject,
    openProject,
    exportDefaults: async () => ({ folder: `Documents/${EXPORT_DIR}`, sep: '/' }),
    chooseFolder: async () => null,
    exists: async (p) => {
      if (!native) return false;
      try {
        await Filesystem.stat({
          path: `${EXPORT_DIR}/${p.split('/').pop()}`,
          directory: Directory.Documents,
        });
        return true;
      } catch {
        return false;
      }
    },
    startExport,
    cancelExport: () => {
      if (!exporting) return;
      cancelled = true;
      resetEngine();
    },
    onExportProgress: (cb) => {
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
    reveal: shareFile,
    openFile: shareFile,
  };
}
