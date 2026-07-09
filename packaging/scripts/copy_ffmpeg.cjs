const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const targetDir = path.join(rootDir, 'dist', 'ffmpeg');

function copyExecutable(sourcePath, targetName) {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error(`Bundled executable was not found: ${sourcePath}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, targetName);
  fs.copyFileSync(sourcePath, targetPath);
  if (process.platform !== 'win32') {
    fs.chmodSync(targetPath, 0o755);
  }
  console.log(`${targetName}: ${sourcePath} -> ${targetPath}`);
}

const ffmpeg = require('@ffmpeg-installer/ffmpeg');
const ffprobe = require('@ffprobe-installer/ffprobe');
const extension = process.platform === 'win32' ? '.exe' : '';

copyExecutable(ffmpeg.path, `ffmpeg${extension}`);
copyExecutable(ffprobe.path, `ffprobe${extension}`);
