// Copies the signed release APK next to the desktop installers in release/.
const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const src = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(src)) {
  console.error('No signed APK found. Is ~/.reacut-android/keystore.properties set up?');
  process.exit(1);
}
fs.mkdirSync(path.join(__dirname, '..', 'release'), { recursive: true });
const dest = path.join(__dirname, '..', 'release', `ReaCut-${version}.apk`);
fs.copyFileSync(src, dest);
console.log(`Copied ${dest}`);
