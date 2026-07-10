<p align="right">
  <strong>English</strong> · <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="https://orcestr.com/media-transcriber">
    <img src="./assets/media-transcriber-banner.png" alt="Orcestr Media Transcriber banner" width="100%" />
  </a>
</p>

# Orcestr Media Transcriber

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Turn local audio and video files into MP3 files and readable transcripts through OpenAI.

Orcestr Media Transcriber helps process meetings, voice notes, demos, interviews and other recordings without manually preparing or splitting media. Drop or select multiple files, choose the desired output and track every file in one queue.

Part of the [Orcestr](https://orcestr.com) ecosystem.

## What it can do

- Process multiple local audio and video files in one batch.
- Create `.mp3`, `.txt` or both formats.
- Save results next to the source file with the same base name.
- Show live progress separately for each file.
- Preview, copy and download completed transcripts.
- Convert video to audio automatically.
- Split long recordings into manageable chunks.
- Align chunk boundaries near silence when possible.
- Process files and transcription chunks in parallel.
- Retry temporary transcription failures automatically.

## How it works

1. Drop files into the app or select them from the file picker.
2. Choose MP3, transcript or both outputs.
3. Start processing and follow the progress of every file.
4. Open the generated files next to the originals.

Long recordings are converted with `ffmpeg`, split into audio chunks and sent to OpenAI for transcription. An OpenAI API key and an internet connection are required for transcript generation. The API key is entered in the app and stored locally on the device.

## Desktop platforms

- Windows x64
- macOS x64 and Apple Silicon
- Linux x64

The desktop app includes everything needed for media processing. Python, Node.js and a separate FFmpeg installation are not required.

## Links

- [Product page](https://orcestr.com/media-transcriber)
- [Orcestr](https://orcestr.com)
- [Orcestr overview](https://github.com/Artasov/orcestr-overview)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [License](./LICENSE)
