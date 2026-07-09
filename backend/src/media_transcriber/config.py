from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(repo_root() / ".env", backend_root() / ".env", ".env"),
        env_file_encoding="utf-8",
        env_prefix="",
        extra="ignore",
        case_sensitive=False,
    )

    host: str = "127.0.0.1"
    port: int = 3933
    artifacts_dir: Path = Field(default_factory=lambda: repo_root() / "artifacts")
    ffmpeg_dir: Path | None = Field(default=None, alias="ORCESTR_FFMPEG_DIR")

    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_transcription_model: str = Field(default="gpt-4o-mini-transcribe")
    openai_audio_chunk_seconds: int = Field(default=120, ge=30, le=900)
    openai_request_timeout_s: int = Field(default=120, ge=10, le=1800)

    transcription_concurrency: int = Field(default=2, ge=1, le=8)
    transcription_upload_max_mb: int = Field(default=10_000, ge=1, le=100_000)

    @field_validator("artifacts_dir", mode="before")
    @classmethod
    def normalize_artifacts_dir(cls, value: object) -> object:
        if isinstance(value, str) and value.strip():
            path = Path(value)
            return path if path.is_absolute() else repo_root() / path
        if isinstance(value, Path) and not value.is_absolute():
            return repo_root() / value
        return value

    @field_validator("ffmpeg_dir", mode="before")
    @classmethod
    def normalize_optional_path(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            path = Path(stripped)
            return path if path.is_absolute() else repo_root() / path
        if isinstance(value, Path) and not value.is_absolute():
            return repo_root() / value
        return value

    def create_dirs(self) -> None:
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.create_dirs()
    return settings
