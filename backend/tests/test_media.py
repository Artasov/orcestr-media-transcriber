from __future__ import annotations

from pathlib import Path

import pytest

from media_transcriber.config import Settings
from media_transcriber.media import MediaSourceService
from media_transcriber.transcription import OpenAITranscriber

DEFAULT_UPLOAD_MAX_MB = 10_000


def test_default_upload_limit_allows_large_local_recordings() -> None:
    settings = Settings()

    assert settings.transcription_upload_max_mb == DEFAULT_UPLOAD_MAX_MB


def test_safe_filename_strips_paths_and_unsafe_chars() -> None:
    settings = Settings(OPENAI_API_KEY="test")
    service = MediaSourceService(settings, OpenAITranscriber(settings))

    assert service.safe_filename("../meeting:*?.mp4") == "meeting_.mp4"


def test_safe_filename_preserves_extension_for_non_latin_names() -> None:
    settings = Settings(OPENAI_API_KEY="test")
    service = MediaSourceService(settings, OpenAITranscriber(settings))

    assert service.safe_filename("созвон.mp4") == "source.mp4"


def test_safe_filename_preserves_suffix_for_non_ascii_name() -> None:
    settings = Settings(OPENAI_API_KEY="test")
    service = MediaSourceService(settings, OpenAITranscriber(settings))

    assert service.safe_filename("встреча.mp4") == "source.mp4"


def test_source_kind_marks_audio_and_video() -> None:
    settings = Settings(OPENAI_API_KEY="test")
    service = MediaSourceService(settings, OpenAITranscriber(settings))

    assert service.source_kind(settings.artifacts_dir / "voice.mp3") == "audio"
    assert service.source_kind(settings.artifacts_dir / "meeting.mkv") == "video"


@pytest.mark.asyncio
async def test_mp3_only_writes_sidecar_audio_without_transcription(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings()
    service = MediaSourceService(settings, OpenAITranscriber(settings))
    source = tmp_path / "meeting.mp4"
    source.write_bytes(b"video")

    async def convert_to_mp3(_source_path: Path, output_path: Path) -> None:
        output_path.write_bytes(b"mp3")

    monkeypatch.setattr(service, "convert_to_mp3", convert_to_mp3)

    transcript, transcript_path, audio_path = await service.transcribe_media_file(
        source,
        generate_mp3=True,
        generate_txt=False,
    )

    assert transcript == ""
    assert transcript_path == source.with_suffix(".txt")
    assert audio_path == source.with_suffix(".mp3")
    assert audio_path.read_bytes() == b"mp3"
    assert not transcript_path.exists()


@pytest.mark.asyncio
async def test_txt_only_uses_temp_audio_and_writes_sidecar_text(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(OPENAI_API_KEY="test")
    transcriber = OpenAITranscriber(settings)
    service = MediaSourceService(settings, transcriber)
    source = tmp_path / "meeting.mov"
    source.write_bytes(b"video")

    async def convert_to_mp3(_source_path: Path, output_path: Path) -> None:
        output_path.write_bytes(b"mp3")

    async def transcribe_audio_file(audio_path: Path, **_kwargs: object) -> str:
        assert audio_path.exists()
        return "hello"

    monkeypatch.setattr(service, "convert_to_mp3", convert_to_mp3)
    monkeypatch.setattr(transcriber, "transcribe_audio_file", transcribe_audio_file)

    transcript, transcript_path, audio_path = await service.transcribe_media_file(
        source,
        generate_mp3=False,
        generate_txt=True,
    )

    assert transcript == "hello"
    assert transcript_path == source.with_suffix(".txt")
    assert transcript_path.read_text(encoding="utf-8") == "hello"
    assert not audio_path.exists()
    assert not source.with_suffix(".mp3").exists()


@pytest.mark.asyncio
async def test_txt_uses_request_openai_api_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings()
    transcriber = OpenAITranscriber(settings)
    service = MediaSourceService(settings, transcriber)
    source = tmp_path / "meeting.mp3"
    source.write_bytes(b"mp3")

    async def audio_duration(_audio_path: Path) -> float:
        return 1.0

    async def transcribe_chunks(_chunks: object, **kwargs: object) -> list[str]:
        assert kwargs["openai_api_key"] == "request-key"
        return ["hello"]

    monkeypatch.setattr(transcriber, "audio_duration", audio_duration)
    monkeypatch.setattr(transcriber, "transcribe_chunks", transcribe_chunks)

    transcript, transcript_path, audio_path = await service.transcribe_media_file(
        source,
        generate_mp3=False,
        generate_txt=True,
        openai_api_key="request-key",
    )

    assert transcript == "hello"
    assert transcript_path.read_text(encoding="utf-8") == "hello"
    assert audio_path == source
