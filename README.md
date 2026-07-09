<p align="right">
  <strong>English</strong> · <a href="./README.ru.md">Русский</a>
</p>
<br/>

# Orcestr Media Transcriber

[![Validate](https://github.com/Artasov/orcestr-media-transcriber/actions/workflows/validate.yml/badge.svg)](https://github.com/Artasov/orcestr-media-transcriber/actions/workflows/validate.yml)
[![Release desktop apps](https://github.com/Artasov/orcestr-media-transcriber/actions/workflows/release-desktop.yml/badge.svg)](https://github.com/Artasov/orcestr-media-transcriber/actions/workflows/release-desktop.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Turn local audio and video files into MP3 files and readable transcripts through OpenAI.

Helps founders, product owners, team leads and developers process meetings, voice notes, demos and interviews without manually splitting media files. Drop or select multiple files, choose whether to generate `.mp3`, `.txt` or both, track progress for each file, and keep the generated files next to the original media with the same base name.

Long media is converted with `ffmpeg`, split into audio chunks, aligned near silence when possible, and sent to OpenAI in parallel with retry/backoff. The UI receives live progress through server-sent events.

Part of the [Orcestr](https://orcestr.com) ecosystem.

## Features

- Batch processing for local audio and video files.
- Optional `.mp3` generation next to the source file.
- Optional `.txt` transcript generation next to the source file.
- FastAPI backend with async upload streaming and in-memory job tracking.
- `ffmpeg`/`ffprobe` preprocessing for video extraction, MP3 conversion and duration detection.
- Silence-aware chunk planning for long files.
- Parallel OpenAI transcription requests with staggered starts and retry backoff.
- React/Vite UI with progress, transcript preview, copy and download actions.
- Optional upload mode that copies files into `artifacts/uploads` before processing.

## Requirements

- Python 3.12
- Node.js 20+
- `uv`
- `ffmpeg` and `ffprobe` in `PATH`
- `OPENAI_API_KEY`

## Install

Create local environment file:

```bash
copy .env.example .env
```

Fill `OPENAI_API_KEY`.

Install backend dependencies:

```bash
cd backend
uv sync --extra dev
```

Install frontend dependencies:

```bash
cd ../frontend
npm install
```

## Run

Start backend:

```bash
cd backend
uv run uvicorn media_transcriber.main:app --app-dir src --host 127.0.0.1 --port 3933
```

Start frontend:

```bash
cd frontend
npm run dev
```

Open the Vite URL printed by `npm run dev`. The frontend runs on `8933` by default and proxies `/api` to `http://127.0.0.1:3933`.

Drop files into the upload area or click it to select several files, then choose outputs:

- `MP3` creates `same-name.mp3` next to each source file.
- `TXT` creates `same-name.txt` next to each source file.
- Selecting both creates both files. Selecting only `TXT` may create a temporary mp3 internally, but it is removed after transcription.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | required | OpenAI API key used for transcription. |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-4o-mini-transcribe` | OpenAI transcription model. |
| `OPENAI_AUDIO_CHUNK_SECONDS` | `120` | Target chunk length for long media. |
| `OPENAI_REQUEST_TIMEOUT_S` | `120` | HTTP timeout for OpenAI requests. |
| `TRANSCRIPTION_CONCURRENCY` | `2` | Number of files processed in parallel. |
| `TRANSCRIPTION_UPLOAD_MAX_MB` | `10000` | Maximum upload size per file. |
| `ARTIFACTS_DIR` | `./artifacts` | Storage for optional upload mode. Path-based processing writes outputs next to source files. |

## Development

Backend checks:

```bash
cd backend
uv run pytest
uv run ruff check src tests
uv run mypy
```

Frontend checks:

```bash
cd frontend
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

## Desktop releases

Desktop builds are produced by GitHub Actions from tags matching `v*`.

The release workflow builds native artifacts on each target OS:

- Windows x64: NSIS installer `.exe`.
- macOS x64 and arm64: `.dmg`.
- Linux x64: `.deb` and `.AppImage`.

The desktop app bundles:

- the production Vite frontend;
- a PyInstaller backend sidecar;
- `ffmpeg` and `ffprobe`;
- a Tauri 2 native shell based on the operating system WebView;
- third-party notices.

Python, Node.js and FFmpeg are not required on the end user's computer.

Local Windows packaging:

```bash
npm install
cd frontend
npm install
cd ../backend
uv sync --extra package
cd ..
npm run package:desktop
```

Local desktop packaging also requires the stable Rust toolchain and the platform prerequisites from the [Tauri documentation](https://v2.tauri.app/start/prerequisites/).

Artifacts are written to `release/`.

To create a release from CI, push a version tag:

```bash
git tag v0.0.1
git push origin v0.0.1
```

Shared PyCharm run configurations `release patch`, `release minor` and `release major` synchronize all frontend, backend and Tauri versions, then create a local release commit and `vX.Y.Z` tag. Push the commit and tag shown by the command to start the desktop release workflow.

macOS builds use an ad-hoc signature. Windows and macOS may still show trust warnings until publisher signing and Apple notarization are configured.

## Architecture

The backend is intentionally small:

- `backend/src/media_transcriber/main.py` exposes the REST and SSE API.
- `backend/src/media_transcriber/jobs.py` keeps active jobs in memory and publishes progress events.
- `backend/src/media_transcriber/media.py` handles upload storage, file type detection and MP3 conversion.
- `backend/src/media_transcriber/transcription.py` contains chunk planning, silence alignment, OpenAI calls and retry logic.

Job state is in memory and resets after backend restart. Path-based outputs remain next to the source files. Uploaded media remains under `artifacts/`.

## Security

Do not expose the backend to untrusted networks. This is a local tool that accepts media uploads and reads/writes local files.

Do not commit `.env`, API keys, uploaded recordings or generated transcripts.

See [Security](./SECURITY.md).

## Links

- [Orcestr website](https://orcestr.com)
- [Orcestr overview](https://github.com/Artasov/orcestr-overview)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [License](./LICENSE)
