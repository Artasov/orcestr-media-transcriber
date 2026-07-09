const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const bundlesByPlatform = {
  win32: 'nsis',
  darwin: 'dmg',
  linux: 'deb,appimage',
};
const bundles = bundlesByPlatform[process.platform];

if (!bundles) {
  throw new Error(`Desktop packaging is not configured for ${process.platform}.`);
}

const cliPath = path.join(rootDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const result = spawnSync(process.execPath, [cliPath, 'build', '--bundles', bundles], {
  cwd: rootDir,
  stdio: 'inherit',
});
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const releaseDir = path.join(rootDir, 'release');
const bundleRoot = path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

const artifacts = [];
if (process.platform === 'win32') {
  artifacts.push({ directory: 'nsis', extension: '.exe', platform: 'windows' });
} else if (process.platform === 'darwin') {
  artifacts.push({ directory: 'dmg', extension: '.dmg', platform: 'macos' });
} else {
  artifacts.push({ directory: 'deb', extension: '.deb', platform: 'linux' });
  artifacts.push({ directory: 'appimage', extension: '.AppImage', platform: 'linux' });
}

for (const artifact of artifacts) {
  const sourceDir = path.join(bundleRoot, artifact.directory);
  const sourceName = fs.readdirSync(sourceDir).find((name) => name.endsWith(artifact.extension));
  if (!sourceName) {
    throw new Error(`No ${artifact.extension} artifact was found in ${sourceDir}.`);
  }
  const targetName = `orcestr-media-transcriber-${packageJson.version}-${artifact.platform}-${arch}${artifact.extension}`;
  fs.copyFileSync(path.join(sourceDir, sourceName), path.join(releaseDir, targetName));
  console.log(`Desktop artifact: ${path.join(releaseDir, targetName)}`);
}
