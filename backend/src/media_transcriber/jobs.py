from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from media_transcriber.config import Settings
from media_transcriber.media import MediaSourceService
from media_transcriber.schemas import JobStatus, TranscriptionJobOut

logger = logging.getLogger("media_transcriber.jobs")


@dataclass
class TranscriptionJob:
    id: str
    name: str
    source_path: Path
    source_kind: str
    size: int
    status: JobStatus = "queued"
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    chunks_completed: int = 0
    chunks_count: int = 0
    generate_mp3: bool = True
    generate_txt: bool = True
    openai_api_key: str | None = field(default=None, repr=False)
    transcript: str = ""
    transcript_path: Path | None = None
    audio_path: Path | None = None
    error: str | None = None
    subscribers: list[asyncio.Queue[dict[str, object]]] = field(default_factory=list)


class JobNotFoundError(Exception):
    """Raised when a transcription job id does not exist in memory."""


class TranscriptionJobManager:
    def __init__(self, settings: Settings, media_service: MediaSourceService) -> None:
        self.settings = settings
        self.media_service = media_service
        self.jobs: dict[str, TranscriptionJob] = {}
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.lock = asyncio.Lock()
        self.semaphore = asyncio.Semaphore(settings.transcription_concurrency)

    async def create_job(
        self,
        source_path: Path,
        *,
        generate_mp3: bool = True,
        generate_txt: bool = True,
        openai_api_key: str | None = None,
    ) -> TranscriptionJobOut:
        stat = source_path.stat()
        kind = self.media_service.source_kind(source_path)
        job = TranscriptionJob(
            id=str(uuid.uuid4()),
            name=source_path.name,
            source_path=source_path,
            source_kind=kind,
            size=stat.st_size,
            generate_mp3=generate_mp3,
            generate_txt=generate_txt,
            openai_api_key=openai_api_key,
        )
        async with self.lock:
            self.jobs[job.id] = job
        logger.info(
            "Job created: job_id=%s name=%r kind=%s size=%s generate_mp3=%s generate_txt=%s",
            job.id,
            job.name,
            job.source_kind,
            job.size,
            job.generate_mp3,
            job.generate_txt,
        )
        task = asyncio.create_task(self.run_job(job.id), name=f"transcription-{job.id[:8]}")
        self.tasks[job.id] = task
        task.add_done_callback(lambda _done: self.tasks.pop(job.id, None))
        await self.publish(job, "job.created")
        return self.job_out(job)

    async def list_jobs(self) -> list[TranscriptionJobOut]:
        async with self.lock:
            jobs = sorted(self.jobs.values(), key=lambda item: item.created_at, reverse=True)
            return [self.job_out(job) for job in jobs]

    async def get_job(self, job_id: str) -> TranscriptionJobOut:
        job = await self.job(job_id)
        return self.job_out(job)

    async def job(self, job_id: str) -> TranscriptionJob:
        async with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            raise JobNotFoundError(job_id)
        return job

    async def run_job(self, job_id: str) -> None:
        job = await self.job(job_id)
        async with self.semaphore:
            logger.info("Job started: job_id=%s source_path=%s", job.id, job.source_path)
            await self.set_status(job, "processing")

            async def on_chunk_done(chunk_index: int, chunks_completed: int, chunks_count: int) -> None:
                job.status = "transcribing"
                job.chunks_completed = chunks_completed
                job.chunks_count = chunks_count
                job.updated_at = datetime.now(UTC)
                await self.publish(
                    job,
                    "job.chunk_done",
                    {
                        "chunk_index": chunk_index,
                        "chunks_completed": chunks_completed,
                        "chunks_count": chunks_count,
                    },
                )
                logger.info(
                    "Job chunk completed: job_id=%s chunk_index=%s chunks_completed=%s chunks_count=%s",
                    job.id,
                    chunk_index,
                    chunks_completed,
                    chunks_count,
                )

            try:
                transcript, transcript_path, audio_path = await self.media_service.transcribe_media_file(
                    job.source_path,
                    generate_mp3=job.generate_mp3,
                    generate_txt=job.generate_txt,
                    openai_api_key=job.openai_api_key,
                    on_chunk_done=on_chunk_done,
                )
            except Exception as exc:
                job.status = "failed"
                job.error = str(exc)
                job.updated_at = datetime.now(UTC)
                await self.publish(job, "job.failed")
                logger.exception("Job failed: job_id=%s error=%s", job.id, exc)
                return

            job.status = "completed"
            job.transcript = transcript
            job.transcript_path = transcript_path if job.generate_txt else None
            job.audio_path = audio_path if job.generate_mp3 else None
            job.chunks_completed = max(job.chunks_completed, 1)
            job.chunks_count = max(job.chunks_count, job.chunks_completed)
            job.updated_at = datetime.now(UTC)
            await self.publish(job, "job.completed")
            logger.info(
                "Job completed: job_id=%s transcript_path=%s audio_path=%s chunks=%s/%s",
                job.id,
                job.transcript_path,
                job.audio_path,
                job.chunks_completed,
                job.chunks_count,
            )

    async def set_status(self, job: TranscriptionJob, status: JobStatus) -> None:
        job.status = status
        job.updated_at = datetime.now(UTC)
        await self.publish(job, "job.status")

    async def publish(
        self,
        job: TranscriptionJob,
        event: str,
        payload: dict[str, object] | None = None,
    ) -> None:
        message: dict[str, object] = {
            "event": event,
            "job": self.job_out(job).model_dump(mode="json"),
        }
        if payload:
            message.update(payload)
        for queue in list(job.subscribers):
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                with contextlib.suppress(ValueError):
                    job.subscribers.remove(queue)

    async def stream_events(self, job_id: str) -> AsyncIterator[str]:
        job = await self.job(job_id)
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue(maxsize=100)
        job.subscribers.append(queue)
        logger.info("SSE stream opened: job_id=%s subscribers=%s", job_id, len(job.subscribers))
        initial: dict[str, object] = {
            "event": "job.snapshot",
            "job": self.job_out(job).model_dump(mode="json"),
        }
        try:
            yield self.sse_message(initial)
            while True:
                message = await queue.get()
                yield self.sse_message(message)
                current = message.get("job")
                if isinstance(current, dict) and current.get("status") in {"completed", "failed"}:
                    break
        finally:
            if queue in job.subscribers:
                job.subscribers.remove(queue)
            logger.info("SSE stream closed: job_id=%s subscribers=%s", job_id, len(job.subscribers))

    def sse_message(self, message: dict[str, object]) -> str:
        event = str(message.get("event") or "message")
        return f"event: {event}\ndata: {json.dumps(message)}\n\n"

    def job_out(self, job: TranscriptionJob) -> TranscriptionJobOut:
        return TranscriptionJobOut(
            id=job.id,
            name=job.name,
            source_path=str(job.source_path),
            source_kind=job.source_kind,
            size=job.size,
            status=job.status,
            created_at=job.created_at,
            updated_at=job.updated_at,
            chunks_completed=job.chunks_completed,
            chunks_count=job.chunks_count,
            generate_mp3=job.generate_mp3,
            generate_txt=job.generate_txt,
            transcript=job.transcript,
            transcript_path=str(job.transcript_path) if job.transcript_path is not None else None,
            audio_path=str(job.audio_path) if job.audio_path is not None else None,
            error=job.error,
        )
