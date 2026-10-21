// Desktop file access for the shared export graph builder (shared/render.mjs).
const fs = require('fs');
const path = require('path');
const render = require('../shared/render.mjs');

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  'C:\\Windows\\Fonts\\arialbd.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\segoeui.ttf',
];

const nodeIo = {
  exists: (p) => fs.existsSync(p),
  readText: (p) => fs.readFileSync(p, 'utf8'),
  writeText: (p, text) => fs.writeFileSync(p, text, 'utf8'),
  join: (...parts) => path.join(...parts),
  fonts: FONT_CANDIDATES,
  platform: process.platform,
};

function buildExportArgs(project, outPath, tmpDir, settings) {
  return render.buildExportArgs(project, outPath, tmpDir, settings, nodeIo);
}

module.exports = { buildExportArgs };
