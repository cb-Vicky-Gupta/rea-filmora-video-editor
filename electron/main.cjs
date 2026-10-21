const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const { buildExportArgs } = require('./exporter.cjs');
const { createMediaTools, IMAGE_EXT, AUDIO_EXT } = require('./media.cjs');

const isWin = process.platform === 'win32';
// Packaged builds ship ffmpeg for the target platform in resources/ (see scripts/fetch-ffmpeg.cjs);
// development uses the binary from ffmpeg-static.
const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, isWin ? 'ffmpeg.exe' : 'ffmpeg')
  : require('ffmpeg-static');

const VIDEO_EXT = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'wmv',
  'flv',
  'mts',
  'm2ts',
  'ts',
  '3gp',
  'mpg',
  'mpeg',
  'ogv',
];
const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'reacut-'));
// Only files the user explicitly imported can be served to the renderer.
const allowedFiles = new Set();
const mediaTools = createMediaTools({
  ffmpegPath,
  cacheDir: path.join(app.getPath('userData'), 'media-cache'),
  allow: (p) => allowedFiles.add(p),
});
let mainWindow;
let currentExport = null;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function serveFile(request) {
  const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1));
  if (!allowedFiles.has(filePath)) return new Response('Forbidden', { status: 403 });
  let size;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  // The preview draws frames into WebGL, which needs CORS-approved media.
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  if (!range) {
    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      headers: {
        ...cors,
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    });
  }
  let start, end;
  if (range[1] === '') {
    start = Math.max(0, size - Number(range[2]));
    end = size - 1;
  } else {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
    status: 206,
    headers: {
      ...cors,
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
    },
  });
}

async function probeMany(paths) {
  const results = [];
  for (const p of paths) {
    try {
      results.push(await mediaTools.probe(p));
    } catch (e) {
      results.push({ error: e.message, path: p });
    }
  }
  return results;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#15161a',
    autoHideMenuBar: true,
    ...(isWin
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#1d1f24', symbolColor: '#e7e9ee', height: 44 },
        }
      : { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const devServer = process.argv.find((a) => a.startsWith('--dev-server='))?.split('=')[1];
  if (devServer && !app.isPackaged) mainWindow.loadURL(devServer);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('media:import', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Media',
        extensions: [...VIDEO_EXT, ...[...AUDIO_EXT, ...IMAGE_EXT].map((e) => e.slice(1))],
      },
    ],
  });
  return res.canceled ? [] : probeMany(res.filePaths);
});

ipcMain.handle('media:probe', (_e, paths) => probeMany(paths));

ipcMain.handle('project:save', async (_e, project) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: 'Untitled.reacut',
    filters: [{ name: 'ReaCut Project', extensions: ['reacut'] }],
  });
  if (res.canceled) return null;
  fs.writeFileSync(res.filePath, JSON.stringify(project, null, 2));
  return res.filePath;
});

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'ReaCut Project', extensions: ['reacut'] }],
  });
  if (res.canceled) return null;
  const project = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
  // Re-create thumbnails, waveforms and preview proxies that are no longer cached.
  for (const [id, m] of Object.entries(project.media || {})) {
    project.media[id] = await mediaTools.ensureAssets(m);
  }
  for (const t of project.tracks || []) {
    for (const c of t.clips) if (c.grade?.lut?.path) allowedFiles.add(c.grade.lut.path);
  }
  return project;
});

ipcMain.handle('lut:import', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: '3D LUT', extensions: ['cube'] }],
  });
  if (res.canceled) return null;
  const filePath = res.filePaths[0];
  allowedFiles.add(filePath);
  return { path: filePath, name: path.basename(filePath, path.extname(filePath)) };
});

ipcMain.handle('lut:read', (_e, filePath) => {
  if (!allowedFiles.has(filePath)) throw new Error('LUT not available');
  return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('export:choosePath', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('movies'), 'My Video.mp4'),
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('export:defaults', () => ({ folder: app.getPath('videos'), sep: path.sep }));

ipcMain.handle('dialog:chooseFolder', async (_e, current) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    defaultPath: current || app.getPath('videos'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('fs:exists', (_e, p) => fs.existsSync(p));

ipcMain.handle('export:start', async (_e, project, outPath, settings) => {
  if (currentExport) throw new Error('An export is already running.');
  const folder = path.dirname(outPath);
  if (!fs.existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
  const jobDir = fs.mkdtempSync(path.join(tmpRoot, 'export-'));
  const { args, total } = buildExportArgs(project, outPath, jobDir, settings);

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    currentExport = proc;
    let log = '';
    let pending = '';
    const stats = {};
    // -progress writes key=value lines in blocks ending with "progress=...".
    proc.stdout.on('data', (buf) => {
      pending += buf.toString();
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (!value) continue;
        stats[key.trim()] = value.trim();
        if (key === 'progress') {
          const done = Math.min(1, (+stats.out_time_us || +stats.out_time_ms || 0) / 1e6 / total);
          mainWindow?.webContents.send('export:progress', {
            progress: done,
            fps: +stats.fps || 0,
            speed: parseFloat(stats.speed) || 0,
            size: +stats.total_size || 0,
          });
        }
      }
    });
    proc.stderr.on('data', (buf) => {
      log = (log + buf.toString()).slice(-8000);
    });
    proc.on('close', (code, signal) => {
      currentExport = null;
      fs.rmSync(jobDir, { recursive: true, force: true });
      if (code === 0) resolve({ ok: true, path: outPath });
      else if (signal) resolve({ ok: false, cancelled: true });
      else reject(new Error(log.split('\n').filter(Boolean).slice(-6).join('\n')));
    });
  });
});

ipcMain.handle('export:cancel', () => {
  currentExport?.kill('SIGTERM');
});

ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));

app.whenReady().then(() => {
  protocol.handle('media', serveFile);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  currentExport?.kill('SIGKILL');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});
