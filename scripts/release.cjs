const { spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const files = {
  rootPackage: 'package.json',
  rootLock: 'package-lock.json',
  frontendPackage: 'frontend/package.json',
  frontendLock: 'frontend/package-lock.json',
  backendProject: 'backend/pyproject.toml',
  backendLock: 'backend/uv.lock',
  tauriConfig: 'src-tauri/tauri.conf.json',
  tauriProject: 'src-tauri/Cargo.toml',
  tauriLock: 'src-tauri/Cargo.lock',
};
const versionFiles = Object.values(files);

class ReleaseError extends Error {}

function absolutePath(relativePath) {
  return path.join(rootDir, relativePath);
}

function readText(relativePath) {
  return readFileSync(absolutePath(relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function writeJson(relativePath, data) {
  writeFileSync(absolutePath(relativePath), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readTomlSectionVersion(relativePath, sectionName) {
  const section = tomlSection(readText(relativePath), sectionName, relativePath);
  const match = section.content.match(/^version\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m);
  if (!match) {
    throw new ReleaseError(`Version was not found in [${sectionName}] of ${relativePath}.`);
  }
  return match[1];
}

function writeTomlSectionVersion(relativePath, sectionName, version) {
  const content = readText(relativePath);
  const section = tomlSection(content, sectionName, relativePath);
  const nextSection = section.content.replace(
    /^(version\s*=\s*")\d+\.\d+\.\d+("\s*)$/m,
    `$1${version}$2`,
  );
  if (nextSection === section.content) {
    throw new ReleaseError(`Version was not updated in [${sectionName}] of ${relativePath}.`);
  }
  writeFileSync(
    absolutePath(relativePath),
    `${content.slice(0, section.start)}${nextSection}${content.slice(section.end)}`,
    'utf8',
  );
}

function tomlSection(content, sectionName, relativePath) {
  const marker = `[${sectionName}]`;
  const start = content.indexOf(marker);
  if (start === -1) {
    throw new ReleaseError(`Section ${marker} was not found in ${relativePath}.`);
  }
  const nextSection = content.indexOf('\n[', start + marker.length);
  const end = nextSection === -1 ? content.length : nextSection + 1;
  return { content: content.slice(start, end), start, end };
}

function readLockPackageVersion(relativePath, packageName) {
  const block = lockPackageBlock(readText(relativePath), packageName, relativePath);
  const match = block.content.match(/^version\s*=\s*"(\d+\.\d+\.\d+)"\s*$/m);
  if (!match) {
    throw new ReleaseError(`Version for ${packageName} was not found in ${relativePath}.`);
  }
  return match[1];
}

function writeLockPackageVersion(relativePath, packageName, version) {
  const content = readText(relativePath);
  const block = lockPackageBlock(content, packageName, relativePath);
  const nextBlock = block.content.replace(
    /^(version\s*=\s*")\d+\.\d+\.\d+("\s*)$/m,
    `$1${version}$2`,
  );
  if (nextBlock === block.content) {
    throw new ReleaseError(`Version for ${packageName} was not updated in ${relativePath}.`);
  }
  writeFileSync(
    absolutePath(relativePath),
    `${content.slice(0, block.start)}${nextBlock}${content.slice(block.end)}`,
    'utf8',
  );
}

function lockPackageBlock(content, packageName, relativePath) {
  const marker = `name = "${packageName}"`;
  const nameIndex = content.indexOf(marker);
  if (nameIndex === -1) {
    throw new ReleaseError(`Package ${packageName} was not found in ${relativePath}.`);
  }
  const start = content.lastIndexOf('[[package]]', nameIndex);
  const nextPackage = content.indexOf('[[package]]', nameIndex + marker.length);
  const end = nextPackage === -1 ? content.length : nextPackage;
  if (start === -1) {
    throw new ReleaseError(`Package block for ${packageName} was not found in ${relativePath}.`);
  }
  return { content: content.slice(start, end), start, end };
}

function packageVersion(relativePath) {
  const version = readJson(relativePath).version;
  if (typeof version !== 'string') {
    throw new ReleaseError(`Version was not found in ${relativePath}.`);
  }
  return version;
}

function currentVersion() {
  const versions = new Map([
    [files.rootPackage, packageVersion(files.rootPackage)],
    [files.rootLock, packageVersion(files.rootLock)],
    [files.frontendPackage, packageVersion(files.frontendPackage)],
    [files.frontendLock, packageVersion(files.frontendLock)],
    [files.backendProject, readTomlSectionVersion(files.backendProject, 'project')],
    [files.backendLock, readLockPackageVersion(files.backendLock, 'orcestr-media-transcriber')],
    [files.tauriConfig, packageVersion(files.tauriConfig)],
    [files.tauriProject, readTomlSectionVersion(files.tauriProject, 'package')],
    [files.tauriLock, readLockPackageVersion(files.tauriLock, 'orcestr-media-transcriber-desktop')],
  ]);
  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size !== 1) {
    const details = [...versions].map(([file, version]) => `${file}: ${version}`).join('\n');
    throw new ReleaseError(`Project versions are out of sync:\n${details}`);
  }
  return versions.values().next().value;
}

function bumpVersion(version, part) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new ReleaseError(`Unsupported project version: ${version}.`);
  }
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (part === 'patch') {
    patch += 1;
  } else if (part === 'minor') {
    minor += 1;
    patch = 0;
  } else if (part === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else {
    throw new ReleaseError(`Unsupported release part: ${part}.`);
  }
  return `${major}.${minor}.${patch}`;
}

function writeVersion(version) {
  const rootPackage = readJson(files.rootPackage);
  rootPackage.version = version;
  writeJson(files.rootPackage, rootPackage);

  const rootLock = readJson(files.rootLock);
  rootLock.version = version;
  rootLock.packages[''].version = version;
  writeJson(files.rootLock, rootLock);

  const frontendPackage = readJson(files.frontendPackage);
  frontendPackage.version = version;
  writeJson(files.frontendPackage, frontendPackage);

  const frontendLock = readJson(files.frontendLock);
  frontendLock.version = version;
  frontendLock.packages[''].version = version;
  writeJson(files.frontendLock, frontendLock);

  const tauriConfig = readJson(files.tauriConfig);
  tauriConfig.version = version;
  writeJson(files.tauriConfig, tauriConfig);

  writeTomlSectionVersion(files.backendProject, 'project', version);
  writeLockPackageVersion(files.backendLock, 'orcestr-media-transcriber', version);
  writeTomlSectionVersion(files.tauriProject, 'package', version);
  writeLockPackageVersion(files.tauriLock, 'orcestr-media-transcriber-desktop', version);
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: options.captureOutput ? 'pipe' : 'inherit',
  });
  if (result.error) {
    throw new ReleaseError(result.error.message);
  }
  if (result.status !== 0 && options.check !== false) {
    throw new ReleaseError(`git ${args.join(' ')} failed.`);
  }
  return result;
}

function checkWorktreeIsClean() {
  const result = runGit(['status', '--short'], { captureOutput: true });
  if (result.stdout.trim()) {
    throw new ReleaseError('Git worktree is not clean. Commit or stash changes before release.');
  }
}

function checkTagDoesNotExist(tagName) {
  const result = runGit(['rev-parse', '-q', '--verify', `refs/tags/${tagName}`], {
    captureOutput: true,
    check: false,
  });
  if (result.status === 0) {
    throw new ReleaseError(`Git tag ${tagName} already exists.`);
  }
}

function release(part, options) {
  const current = currentVersion();
  const next = bumpVersion(current, part);
  const tagName = `v${next}`;

  console.log('Package: Orcestr Media Transcriber');
  console.log(`Current version: ${current}`);
  console.log(`Next version: ${next}`);
  console.log(`Tag: ${tagName}`);

  if (options.dryRun) {
    console.log('Dry run mode. No files or git objects were changed.');
    return;
  }

  checkWorktreeIsClean();
  checkTagDoesNotExist(tagName);
  writeVersion(next);
  runGit(['add', ...versionFiles]);
  runGit(['commit', '-m', `chore: release Orcestr Media Transcriber ${tagName}`]);
  runGit(['tag', tagName]);

  if (options.push) {
    runGit(['push']);
    runGit(['push', 'origin', tagName]);
    console.log(`Release ${tagName} was pushed and desktop CI was started.`);
    return;
  }

  console.log('Release commit and tag were created locally.');
  console.log('Run these commands when you are ready to publish:');
  console.log('  git push');
  console.log(`  git push origin ${tagName}`);
}

function main() {
  const [, , part, ...flags] = process.argv;
  const allowedParts = new Set(['patch', 'minor', 'major']);
  const allowedFlags = new Set(['--push', '--dry-run']);
  if (!allowedParts.has(part) || flags.some((flag) => !allowedFlags.has(flag))) {
    throw new ReleaseError(
      'Usage: node scripts/release.cjs <patch|minor|major> [--push] [--dry-run]',
    );
  }
  release(part, {
    dryRun: flags.includes('--dry-run'),
    push: flags.includes('--push'),
  });
}

try {
  main();
} catch (error) {
  console.error(`Release error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
