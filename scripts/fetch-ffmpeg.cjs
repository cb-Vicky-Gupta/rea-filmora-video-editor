// Downloads the ffmpeg binary for a target platform into vendor/ffmpeg/<platform>-<arch>/,
// which electron-builder copies into the app's resources. ffmpeg-static only installs the
// binary for the machine running `npm install`, so cross-platform builds need this.
//
//   node scripts/fetch-ffmpeg.cjs win32 x64
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
const dir = path.join(__dirname, '..', 'vendor', 'ffmpeg', `${platform}-${arch}`);
const bin = path.join(dir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

if (fs.existsSync(bin)) {
  console.log(`ffmpeg for ${platform}-${arch} already present`);
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true });
const installer = require.resolve('ffmpeg-static/install.js');
const res = spawnSync(process.execPath, [installer], {
  stdio: 'inherit',
  env: { ...process.env, FFMPEG_BIN: bin, npm_config_platform: platform, npm_config_arch: arch },
});
if (res.status !== 0 || !fs.existsSync(bin)) {
  console.error(`Failed to download ffmpeg for ${platform}-${arch}`);
  process.exit(1);
}
console.log(`Downloaded ${bin}`);
