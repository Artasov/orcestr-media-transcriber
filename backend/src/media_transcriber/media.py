from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import unquote

from media_transcriber.config import Settings
from media_transcriber.transcription import OpenAITranscriber, ProgressCallback, TranscriptionError

TEXT_SUFFIXES = {".txt", ".md", ".markdown", ".rst", ".log"}
AUDIO_SUFFIXES = {".mp3", ".m4a", ".mp4a", ".wav", ".webm", ".ogg", ".oga", ".flac", ".aac"}
VIDEO_SUFFIXES = {".mp4", ".mov", ".mkv", ".avi", ".m4v", ".webm"}
SAFE_STEM_RE = re.compile(r"[^A-Za-z0-9._ -]+")
SAFE_SUFFIX_RE = re.compile(r"[^A-Za-z0-9.]+")

logger = logging.getLogger("media_transcriber.media")


class MediaError(Exception):
    """Raised when upload handling or media preprocessing fails."""


class MediaSourceService:
    def __init__(self, settings: Settings, transcriber: OpenAITranscriber) -> None:
        self.settings = settings
        self.transcriber = transcriber

    async def save_upload(self, *, filename: str, chunks: AsyncIterator[bytes]) -> Path:
        upload_dir = self.settings.artifacts_dir / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        safe_name = self.safe_filename(filename)
        target = self.unique_path(upload_dir / safe_name)
        max_bytes = self.settings.transcription_upload_max_mb * 1024 * 1024
        total = 0
        logger.info(
            "Saving upload: original_filename=%r safe_filename=%r target=%s",
            filename,
            safe_name,
            target,
        )
        try:
            with target.open("wb") as file_obj:
                async for chunk in chunks:
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > max_bytes:
                        raise MediaError(
                            f"uploaded file is larger than {self.settings.transcription_upload_max_mb} MB"
                        )
                    file_obj.write(chunk)
        except (OSError, MediaError):
            target.unlink(missing_ok=True)
            raise
        if total == 0:
            target.unlink(missing_ok=True)
            raise MediaError("uploaded file is empty")
        logger.info("Upload saved: path=%s size=%s", target, total)
        return target

    async def transcribe_media_file(
        self,
        source_path: Path,
        *,
        generate_mp3: bool,
        generate_txt: bool,
        openai_api_key: str | None = None,
        on_chunk_done: ProgressCallback | None = None,
    ) -> tuple[str, Path, Path]:
        kind = self.source_kind(source_path)
        logger.info(
            "Media processing started: path=%s kind=%s generate_mp3=%s generate_txt=%s",
            source_path,
            kind,
            generate_mp3,
            generate_txt,
        )
        if kind not in {"audio", "video"}:
            raise MediaError(f"file cannot be transcribed: {source_path.name}")
        if not generate_mp3 and not generate_txt:
            raise MediaError("select MP3, TXT or both")
        if generate_txt and not (openai_api_key or self.settings.openai_api_key):
            raise MediaError("OPENAI_API_KEY is not set")

        audio_path = await self.audio_path_for(source_path, generate_mp3=generate_mp3)
        transcript = ""
        transcript_path = source_path.with_suffix(".txt")
        try:
            if generate_txt:
                logger.info("Transcription started: audio_path=%s source_path=%s", audio_path, source_path)
                try:
                    transcript = await self.transcriber.transcribe_audio_file(
                        audio_path,
                        openai_api_key=openai_api_key,
                        on_chunk_done=on_chunk_done,
                    )
                except TranscriptionError as exc:
                    raise MediaError(str(exc)) from exc
                transcript_path = self.write_sidecar_text(source_path, transcript)
                logger.info(
                    "Transcription text written: transcript_path=%s characters=%s",
                    transcript_path,
                    len(transcript),
                )
            elif on_chunk_done is not None:
                await on_chunk_done(0, 1, 1)
        finally:
            if not generate_mp3 and audio_path != source_path:
                audio_path.unlink(missing_ok=True)
        return transcript, transcript_path, audio_path

    async def audio_path_for(self, source_path: Path, *, generate_mp3: bool) -> Path:
        if source_path.suffix.lower() == ".mp3":
            return source_path
        if generate_mp3:
            output_path = source_path.with_suffix(".mp3")
            await self.convert_to_mp3(source_path, output_path)
            return output_path
        return await self.convert_to_temp_mp3(source_path)

    async def convert_to_temp_mp3(self, source_path: Path) -> Path:
        fd, temp_name = tempfile.mkstemp(suffix=".mp3")
        with contextlib.suppress(OSError):
            os.close(fd)
        temp_path = Path(temp_name)
        temp_path.unlink(missing_ok=True)
        try:
            await self.convert_to_mp3(source_path, temp_path)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise
        return temp_path

    async def convert_to_mp3(self, source_path: Path, output_path: Path) -> None:
        if output_path.exists() and output_path.stat().st_size > 0:
            logger.info("MP3 already exists, skipping conversion: output_path=%s", output_path)
            return
        logger.info("Converting media to MP3: source_path=%s output_path=%s", source_path, output_path)
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        await self.run_command(
            [
                ffmpeg,
                "-y",
                "-i",
                str(source_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-codec:a",
                "libmp3lame",
                "-q:a",
                "4",
                str(output_path),
            ]
        )
        logger.info("MP3 conversion completed: output_path=%s", output_path)

    def write_sidecar_text(self, source_path: Path, text: str) -> Path:
        sidecar = source_path.with_suffix(".txt")
        try:
            sidecar.write_text(text, encoding="utf-8")
        except OSError as exc:
            raise MediaError(f"could not write transcript: {exc}") from exc
        return sidecar

    async def run_command(self, command: list[str]) -> tuple[bytes, bytes]:
        try:
            process = await asyncio.to_thread(
                subprocess.run,
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
        except OSError as exc:
            raise MediaError(str(exc)) from exc
        if process.returncode != 0:
            detail = (process.stderr or process.stdout).decode("utf-8", errors="replace").strip()
            raise MediaError(detail or f"command failed with exit code {process.returncode}")
        return process.stdout, process.stderr

    def source_kind(self, path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix in TEXT_SUFFIXES:
            return "text"
        if suffix in AUDIO_SUFFIXES:
            return "audio"
        if suffix in VIDEO_SUFFIXES:
            return "video"
        return "file"

    def safe_filename(self, filename: str) -> str:
        decoded = unquote(filename or "").strip()
        path_name = Path(decoded).name or "source"
        path = Path(path_name)
        suffix = SAFE_SUFFIX_RE.sub("_", path.suffix).strip(" _")
        if suffix and not suffix.startswith("."):
            suffix = f".{suffix}"
        cleaned_stem = SAFE_STEM_RE.sub("_", path.stem).strip(" .")
        stem = cleaned_stem if re.search(r"[A-Za-z0-9]", cleaned_stem) else "source"
        return f"{stem}{suffix}" if suffix else stem

    def unique_path(self, path: Path) -> Path:
        if not path.exists():
            return path
        stem = path.stem or "source"
        suffix = path.suffix
        for index in range(1, 10_000):
            candidate = path.with_name(f"{stem}-{index}{suffix}")
            if not candidate.exists():
                return candidate
        raise MediaError(f"could not create unique upload path for {path}")
