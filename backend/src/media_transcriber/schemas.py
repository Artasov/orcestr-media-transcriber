from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

JobStatus = Literal["queued", "processing", "transcribing", "completed", "failed"]


class TranscriptionJobOut(BaseModel):
    id: str
    name: str
    source_path: str
    source_kind: str
    size: int
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    chunks_completed: int = 0
    chunks_count: int = 0
    generate_mp3: bool = True
    generate_txt: bool = True
    transcript: str = ""
    transcript_path: str | None = None
    audio_path: str | None = None
    error: str | None = None


class PathTranscriptionCreateBody(BaseModel):
    paths: list[str]
    generate_mp3: bool = True
    generate_txt: bool = True


class HealthOut(BaseModel):
    status: str
