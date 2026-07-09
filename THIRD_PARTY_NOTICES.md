# Third-party notices

This project bundles third-party runtime components in desktop release artifacts.

## FFmpeg

Desktop builds bundle `ffmpeg` and `ffprobe` binaries through the npm packages
`@ffmpeg-installer/ffmpeg` and `@ffprobe-installer/ffprobe`.

- FFmpeg project: https://ffmpeg.org/
- FFmpeg source code: https://ffmpeg.org/download.html
- `@ffmpeg-installer/ffmpeg`: https://www.npmjs.com/package/@ffmpeg-installer/ffmpeg
- `@ffprobe-installer/ffprobe`: https://www.npmjs.com/package/@ffprobe-installer/ffprobe

The installer packages are published under LGPL-2.1, while the platform-specific
FFmpeg binaries may include LGPL/GPL components depending on the binary build.
The bundled binaries are distributed as separate command-line programs invoked by
Orcestr Media Transcriber.

If you redistribute desktop artifacts, keep this notice and the project `LICENSE`
with the application bundle.

## Tauri

Desktop builds use Tauri and its official plugins.

- Project: https://tauri.app/
- License: Apache-2.0 OR MIT

## PyInstaller

Backend sidecar binaries are produced with PyInstaller.

- Project: https://pyinstaller.org/
- License: GPL-2.0-or-later with a special exception for distributing generated executables
