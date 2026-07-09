const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const binariesDir = path.join(rootDir, 'src-tauri', 'binaries');
const extension = process.platform === 'win32' ? '.exe' : '';
const sourcePath = path.join(rootDir, 'dist', 'backend', `orcestr-media-backend${extension}`);
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || execFileSync('rustc', ['--print', 'host-tuple'], {
  encoding: 'utf8',
}).trim();

if (!targetTriple) {
  throw new Error('Rust target triple could not be determined.');
}
if (!fs.existsSync(sourcePath)) {
  throw new Error(`Backend sidecar was not found: ${sourcePath}`);
}

fs.mkdirSync(binariesDir, { recursive: true });
for (const entry of fs.readdirSync(binariesDir)) {
  if (entry.startsWith('orcestr-media-backend-')) {
    fs.rmSync(path.join(binariesDir, entry), { force: true });
  }
}

const targetPath = path.join(binariesDir, `orcestr-media-backend-${targetTriple}${extension}`);
fs.copyFileSync(sourcePath, targetPath);
if (process.platform !== 'win32') {
  fs.chmodSync(targetPath, 0o755);
}

console.log(`Tauri sidecar: ${targetPath}`);
