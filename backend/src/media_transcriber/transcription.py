from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import os
import random
import re
import shutil
import subprocess
import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

import httpx

from media_transcriber.config import Settings

logger = logging.getLogger("media_transcriber.transcription")

MIN_TAIL_SECONDS = 20.0
SILENCE_ALIGN_WINDOW_SECONDS = 10.0
SILENCE_NOISE_DB = "-30dB"
SILENCE_MIN_DURATION = 0.4
CHUNK_SAMPLE_RATE = "16000"
CHUNK_AUDIO_BITRATE = "64k"

CHUNK_START_DELAY_SECONDS = 3.0
CHUNK_START_JITTER_SECONDS = 0.5
CHUNK_MAX_ATTEMPTS = 4
CHUNK_RETRY_BASE_DELAY = 2.0
CHUNK_RETRY_MAX_DELAY = 30.0

SILENCE_START_RE = re.compile(r"silence_start:\s*([0-9.]+)")
SILENCE_END_RE = re.compile(r"silence_end:\s*([0-9.]+)")
RETRYABLE_STATUS_CODES = {408, 409, 429, 500, 502, 503, 504}
HTTP_BAD_REQUEST = 400
AUDIO_MIME_TYPES = {
    ".flac": "audio/flac",
    ".mp3": "audio/mpeg",
    ".mp4": "audio/mp4",
    ".mpeg": "audio/mpeg",
    ".mpga": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
}


class TranscriptionError(Exception):
    """Raised when media probing, chunking or OpenAI transcription fails."""


@dataclass(frozen=True)
class AudioChunk:
    index: int
    path: Path
    start_seconds: float
    end_seconds: float
    owns_file: bool


ProgressCallback = Callable[[int, int, int], Awaitable[None]]


class OpenAITranscriber:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def transcribe_audio_file(
        self,
        audio_path: Path,
        *,
        openai_api_key: str | None = None,
        on_chunk_done: ProgressCallback | None = None,
    ) -> str:
        duration = await self.audio_duration(audio_path)
        logger.info("Audio duration detected: audio_path=%s duration_seconds=%.2f", audio_path, duration)
        chunks = await self.plan_chunks(audio_path, duration)
        logger.info("Audio chunk plan ready: audio_path=%s chunks_count=%s", audio_path, len(chunks))
        try:
            texts = await self.transcribe_chunks(
                chunks,
                openai_api_key=openai_api_key,
                on_chunk_done=on_chunk_done,
            )
        finally:
            await self.cleanup_chunks(chunks)
        return " ".join(part for part in texts if part).strip()

    async def plan_chunks(self, audio_path: Path, duration_seconds: float) -> list[AudioChunk]:
        target_chunk_seconds = float(self.settings.openai_audio_chunk_seconds)
        safe_duration = max(0.0, float(duration_seconds))
        if safe_duration <= target_chunk_seconds + MIN_TAIL_SECONDS:
            logger.info(
                "Audio fits single chunk: audio_path=%s duration_seconds=%.2f target_chunk_seconds=%.2f",
                audio_path,
                safe_duration,
                target_chunk_seconds,
            )
            return [AudioChunk(0, audio_path, 0.0, safe_duration, owns_file=False)]

        chunks_count = max(2, math.ceil(safe_duration / target_chunk_seconds))
        ideal_length = safe_duration / chunks_count
        silences = await self.detect_silences(audio_path)
        boundaries = [0.0]
        for boundary_index in range(1, chunks_count):
            ideal = ideal_length * boundary_index
            aligned = self.closest_silence_midpoint(silences, ideal, SILENCE_ALIGN_WINDOW_SECONDS)
            boundaries.append(aligned if aligned is not None else ideal)
        boundaries.append(safe_duration)

        chunks: list[AudioChunk] = []
        try:
            for index in range(chunks_count):
                start = boundaries[index]
                end = boundaries[index + 1]
                logger.info(
                    "Extracting audio chunk: audio_path=%s chunk_index=%s start=%.2f end=%.2f",
                    audio_path,
                    index,
                    start,
                    end,
                )
                chunk_path = await self.extract_chunk(audio_path, start, end)
                chunks.append(AudioChunk(index, chunk_path, start, end, owns_file=True))
        except Exception:
            await self.cleanup_chunks(chunks)
            raise
        return chunks

    async def detect_silences(self, audio_path: Path) -> list[tuple[float, float]]:
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        try:
            _stdout, stderr = await self.run_command(
                [
                    ffmpeg,
                    "-i",
                    str(audio_path),
                    "-af",
                    f"silencedetect=noise={SILENCE_NOISE_DB}:d={SILENCE_MIN_DURATION}",
                    "-f",
                    "null",
                    "-",
                ]
            )
        except TranscriptionError:
            return []
        text = stderr.decode("utf-8", errors="replace")
        starts = [float(match.group(1)) for match in SILENCE_START_RE.finditer(text)]
        ends = [float(match.group(1)) for match in SILENCE_END_RE.finditer(text)]
        pairs: list[tuple[float, float]] = []
        for start, end in zip(starts, ends, strict=False):
            if end > start:
                pairs.append((start, end))
        return pairs

    def closest_silence_midpoint(
        self,
        silences: list[tuple[float, float]],
        target: float,
        window: float,
    ) -> float | None:
        best: float | None = None
        best_distance = window
        for start, end in silences:
            midpoint = (start + end) / 2.0
            distance = abs(midpoint - target)
            if distance < best_distance:
                best_distance = distance
                best = midpoint
        return best

    async def extract_chunk(self, audio_path: Path, start_seconds: float, end_seconds: float) -> Path:
        fd, chunk_name = tempfile.mkstemp(suffix=".mp3")
        with contextlib.suppress(OSError):
            os.close(fd)
        chunk_path = Path(chunk_name)
        chunk_path.unlink(missing_ok=True)
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
        duration = max(0.1, float(end_seconds) - float(start_seconds))
        try:
            await self.run_command(
                [
                    ffmpeg,
                    "-y",
                    "-ss",
                    f"{max(0.0, float(start_seconds)):.3f}",
                    "-t",
                    f"{duration:.3f}",
                    "-i",
                    str(audio_path),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    CHUNK_SAMPLE_RATE,
                    "-b:a",
                    CHUNK_AUDIO_BITRATE,
                    str(chunk_path),
                ]
            )
        except Exception:
            chunk_path.unlink(missing_ok=True)
            raise
        return chunk_path

    async def transcribe_chunks(
        self,
        chunks: list[AudioChunk],
        *,
        openai_api_key: str | None = None,
        on_chunk_done: ProgressCallback | None = None,
    ) -> list[str]:
        if not chunks:
            return []
        if len(chunks) == 1:
            logger.info("Transcribing single chunk: chunk_index=%s path=%s", chunks[0].index, chunks[0].path)
            text = await self.transcribe_chunk_with_retries(
                chunks[0],
                openai_api_key=openai_api_key,
                start_delay=0.0,
            )
            if on_chunk_done is not None:
                await on_chunk_done(chunks[0].index, 1, 1)
            return [text]

        results = ["" for _ in chunks]
        completed_lock = asyncio.Lock()
        completed = {"count": 0}
        start_delays = self.chunk_start_delays(chunks)

        async def worker(chunk: AudioChunk, start_delay: float) -> None:
            logger.info(
                "Transcribing chunk scheduled: chunk_index=%s path=%s start_delay=%.2f",
                chunk.index,
                chunk.path,
                start_delay,
            )
            text = await self.transcribe_chunk_with_retries(
                chunk,
                openai_api_key=openai_api_key,
                start_delay=start_delay,
            )
            results[chunk.index] = text
            async with completed_lock:
                completed["count"] += 1
                completed_now = completed["count"]
            if on_chunk_done is not None:
                await on_chunk_done(chunk.index, completed_now, len(chunks))

        tasks = [
            asyncio.create_task(worker(chunk, delay))
            for chunk, delay in zip(chunks, start_delays, strict=True)
        ]
        try:
            await asyncio.gather(*tasks)
        except Exception:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        return results

    async def transcribe_chunk_with_retries(
        self,
        chunk: AudioChunk,
        *,
        openai_api_key: str | None = None,
        start_delay: float,
    ) -> str:
        if start_delay > 0:
            await asyncio.sleep(start_delay)

        last_error: Exception | None = None
        for attempt in range(1, CHUNK_MAX_ATTEMPTS + 1):
            try:
                logger.info(
                    "Sending chunk to OpenAI: chunk_index=%s attempt=%s path=%s",
                    chunk.index,
                    attempt,
                    chunk.path,
                )
                return await self.transcribe_openai_file(chunk.path, openai_api_key=openai_api_key)
            except Exception as exc:
                if not self.is_retryable_transcription_error(exc):
                    logger.warning(
                        "Chunk transcription failed without retry: chunk_index=%s attempt=%s error=%s",
                        chunk.index,
                        attempt,
                        exc,
                    )
                    raise
                last_error = exc
                if attempt >= CHUNK_MAX_ATTEMPTS:
                    break
                delay = min(CHUNK_RETRY_MAX_DELAY, CHUNK_RETRY_BASE_DELAY * (2 ** (attempt - 1)))
                logger.warning(
                    "Chunk transcription retry scheduled: chunk_index=%s attempt=%s delay=%.2f error=%s",
                    chunk.index,
                    attempt,
                    delay,
                    exc,
                )
                await asyncio.sleep(delay + random.uniform(0.0, 1.0))
        assert last_error is not None
        raise last_error

    def chunk_start_delays(self, chunks: list[AudioChunk]) -> list[float]:
        delays: list[float] = []
        next_delay = 0.0
        for index, _chunk in enumerate(chunks):
            delays.append(next_delay)
            if index >= len(chunks) - 1:
                continue
            next_delay += max(
                0.0,
                CHUNK_START_DELAY_SECONDS
                + random.uniform(-CHUNK_START_JITTER_SECONDS, CHUNK_START_JITTER_SECONDS),
            )
        return delays

    async def transcribe_openai_file(self, file_path: Path, *, openai_api_key: str | None = None) -> str:
        api_key = openai_api_key or self.settings.openai_api_key
        if not api_key:
            raise TranscriptionError("OPENAI_API_KEY is not set")
        mime_type = AUDIO_MIME_TYPES.get(file_path.suffix.lower(), "audio/mpeg")
        headers = {"Authorization": f"Bearer {api_key}"}
        data = {"model": self.settings.openai_transcription_model}
        timeout = httpx.Timeout(self.settings.openai_request_timeout_s)
        async with httpx.AsyncClient(timeout=timeout) as client:
            with file_path.open("rb") as file_obj:
                response = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers=headers,
                    data=data,
                    files={"file": (file_path.name, file_obj, mime_type)},
                )
        logger.info(
            "OpenAI transcription response received: file=%s status_code=%s",
            file_path,
            response.status_code,
        )
        if response.status_code >= HTTP_BAD_REQUEST:
            raise TranscriptionError(
                f"OpenAI transcription failed: HTTP {response.status_code}: {response.text[:500]}"
            )
        parsed = response.json()
        return str(parsed.get("text") or "").strip()

    def is_retryable_transcription_error(self, exc: Exception) -> bool:
        if isinstance(exc, (httpx.TimeoutException, httpx.ConnectError, httpx.RemoteProtocolError)):
            return True
        if isinstance(exc, TranscriptionError):
            match = re.search(r"HTTP\s+(\d+)|status(?: code)?[=: ]+(\d+)", str(exc), flags=re.IGNORECASE)
            if match:
                code = int(match.group(1) or match.group(2))
                return code in RETRYABLE_STATUS_CODES
        return False

    async def audio_duration(self, audio_path: Path) -> float:
        ffprobe = shutil.which("ffprobe") or "ffprobe"
        stdout, _stderr = await self.run_command(
            [
                ffprobe,
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(audio_path),
            ]
        )
        try:
            duration = float(stdout.decode("utf-8", errors="replace").strip())
        except ValueError as exc:
            raise TranscriptionError("could not read audio duration") from exc
        if duration <= 0:
            raise TranscriptionError("audio duration is empty")
        return duration

    async def cleanup_chunks(self, chunks: list[AudioChunk]) -> None:
        for chunk in chunks:
            if chunk.owns_file:
                chunk.path.unlink(missing_ok=True)

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
            raise TranscriptionError(str(exc)) from exc
        if process.returncode != 0:
            detail = (process.stderr or process.stdout).decode("utf-8", errors="replace").strip()
            raise TranscriptionError(detail or f"command failed with exit code {process.returncode}")
        return process.stdout, process.stderr
