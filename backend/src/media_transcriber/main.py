from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from media_transcriber.config import get_settings
from media_transcriber.jobs import JobNotFoundError, TranscriptionJobManager
from media_transcriber.media import MediaError, MediaSourceService
from media_transcriber.schemas import HealthOut, PathTranscriptionCreateBody, TranscriptionJobOut
from media_transcriber.transcription import OpenAITranscriber

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logging.getLogger("media_transcriber").setLevel(logging.INFO)
logger = logging.getLogger("media_transcriber.main")

if sys.platform == "win32" and hasattr(asyncio, "WindowsProactorEventLoopPolicy"):
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

settings = get_settings()
transcriber = OpenAITranscriber(settings)
media_service = MediaSourceService(settings, transcriber)
job_manager = TranscriptionJobManager(settings, media_service)

app = FastAPI(title="Orcestr Media Transcriber")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8933",
        "http://127.0.0.1:8933",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthOut)
async def health() -> HealthOut:
    return HealthOut(status="ok")


@app.get("/api/transcriptions", response_model=list[TranscriptionJobOut])
async def list_transcriptions() -> list[TranscriptionJobOut]:
    return await job_manager.list_jobs()


@app.get("/api/transcriptions/{job_id}", response_model=TranscriptionJobOut)
async def get_transcription(job_id: str) -> TranscriptionJobOut:
    try:
        return await job_manager.get_job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="transcription job not found") from exc


@app.post("/api/transcriptions/upload", response_model=TranscriptionJobOut, status_code=201)
async def upload_transcription_source(
    request: Request,
    x_filename: str | None = Header(default=None),
    x_openai_api_key: str | None = Header(default=None),
    generate_mp3: bool = True,
    generate_txt: bool = True,
) -> TranscriptionJobOut:
    if not generate_mp3 and not generate_txt:
        raise HTTPException(status_code=400, detail="select MP3, TXT or both")
    filename = x_filename or "source"
    logger.info(
        "Upload request received: "
        "filename=%r content_type=%r content_length=%r generate_mp3=%s generate_txt=%s",
        filename,
        request.headers.get("content-type"),
        request.headers.get("content-length"),
        generate_mp3,
        generate_txt,
    )
    try:
        source_path = await media_service.save_upload(filename=filename, chunks=request.stream())
    except MediaError as exc:
        logger.warning("Upload rejected: filename=%r error=%s", filename, exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if media_service.source_kind(source_path) not in {"audio", "video"}:
        logger.warning(
            "Upload rejected: path=%s kind=%s size=%s",
            source_path,
            media_service.source_kind(source_path),
            source_path.stat().st_size if source_path.exists() else 0,
        )
        source_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"file cannot be transcribed: {source_path.name}")

    job = await job_manager.create_job(
        source_path,
        generate_mp3=generate_mp3,
        generate_txt=generate_txt,
        openai_api_key=x_openai_api_key,
    )
    logger.info("Upload accepted: job_id=%s path=%s size=%s", job.id, source_path, source_path.stat().st_size)
    return job


@app.post("/api/transcriptions/paths", response_model=list[TranscriptionJobOut], status_code=201)
async def create_path_transcriptions(
    body: PathTranscriptionCreateBody,
    x_openai_api_key: str | None = Header(default=None),
) -> list[TranscriptionJobOut]:
    if not body.generate_mp3 and not body.generate_txt:
        raise HTTPException(status_code=400, detail="select MP3, TXT or both")
    if not body.paths:
        raise HTTPException(status_code=400, detail="add at least one file path")

    source_paths: list[Path] = []
    for raw_path in body.paths:
        source_path = Path(raw_path).expanduser()
        if not source_path.is_absolute():
            source_path = source_path.resolve()
        if not source_path.exists() or not source_path.is_file():
            raise HTTPException(status_code=404, detail=f"file not found: {raw_path}")
        if media_service.source_kind(source_path) not in {"audio", "video"}:
            raise HTTPException(status_code=400, detail=f"file cannot be processed: {source_path.name}")
        source_paths.append(source_path)

    jobs: list[TranscriptionJobOut] = []
    for source_path in source_paths:
        jobs.append(
            await job_manager.create_job(
                source_path,
                generate_mp3=body.generate_mp3,
                generate_txt=body.generate_txt,
                openai_api_key=x_openai_api_key,
            )
        )
    return jobs


@app.get("/api/transcriptions/{job_id}/events")
async def transcription_events(job_id: str) -> StreamingResponse:
    try:
        await job_manager.job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="transcription job not found") from exc
    logger.info("SSE client connected: job_id=%s", job_id)
    stream = job_manager.stream_events(job_id)
    return StreamingResponse(
        stream,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@app.get("/api/transcriptions/{job_id}/download")
async def download_transcription(job_id: str) -> FileResponse:
    try:
        job = await job_manager.job(job_id)
    except JobNotFoundError as exc:
        raise HTTPException(status_code=404, detail="transcription job not found") from exc
    if job.transcript_path is None or not job.transcript_path.exists():
        raise HTTPException(status_code=404, detail="transcript is not ready")
    return FileResponse(
        job.transcript_path,
        media_type="text/plain; charset=utf-8",
        filename=job.transcript_path.name,
    )
