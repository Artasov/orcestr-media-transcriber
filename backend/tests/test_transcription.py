from __future__ import annotations

import sys
from pathlib import Path

import pytest

from media_transcriber.config import Settings
from media_transcriber.transcription import AudioChunk, OpenAITranscriber

EXPECTED_MIDPOINT = 119.0
EXPECTED_DURATION = 42.5


def test_closest_silence_midpoint_uses_nearest_boundary() -> None:
    transcriber = OpenAITranscriber(Settings(OPENAI_API_KEY="test"))

    midpoint = transcriber.closest_silence_midpoint(
        [(8.0, 12.0), (116.0, 122.0), (250.0, 255.0)],
        target=120.0,
        window=10.0,
    )

    assert midpoint == EXPECTED_MIDPOINT


def test_chunk_start_delays_stagger_requests(monkeypatch: pytest.MonkeyPatch) -> None:
    transcriber = OpenAITranscriber(Settings(OPENAI_API_KEY="test"))
    monkeypatch.setattr("media_transcriber.transcription.random.uniform", lambda *_args: 0.0)
    chunks = [
        AudioChunk(index, Path(f"{index}.mp3"), 0.0, 1.0, owns_file=False)
        for index in range(3)
    ]

    delays = transcriber.chunk_start_delays(chunks)

    assert delays == [0.0, 3.0, 6.0]


@pytest.mark.asyncio
async def test_audio_duration_uses_bundled_ffprobe(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executable_name = "ffprobe.exe" if sys.platform == "win32" else "ffprobe"
    bundled_ffprobe = tmp_path / executable_name
    bundled_ffprobe.touch()
    transcriber = OpenAITranscriber(Settings(ORCESTR_FFMPEG_DIR=tmp_path, OPENAI_API_KEY="test"))
    invoked_command: list[str] = []

    async def run_command(command: list[str]) -> tuple[bytes, bytes]:
        invoked_command.extend(command)
        return str(EXPECTED_DURATION).encode(), b""

    monkeypatch.setattr(transcriber, "run_command", run_command)

    duration = await transcriber.audio_duration(tmp_path / "recording.mp3")

    assert duration == EXPECTED_DURATION
    assert invoked_command[0] == str(bundled_ffprobe)
