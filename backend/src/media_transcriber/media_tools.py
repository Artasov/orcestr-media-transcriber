from __future__ import annotations

import shutil
import sys
from pathlib import Path

from media_transcriber.config import Settings, repo_root

EXECUTABLE_SUFFIX = ".exe" if sys.platform == "win32" else ""


def media_tool_path(settings: Settings, tool_name: str) -> str:
    """Resolve a bundled FFmpeg tool before falling back to PATH."""
    executable_name = f"{tool_name}{EXECUTABLE_SUFFIX}"
    candidate_dirs: list[Path] = []
    if settings.ffmpeg_dir is not None:
        candidate_dirs.append(settings.ffmpeg_dir)
    candidate_dirs.append(repo_root() / "dist" / "ffmpeg")
    if getattr(sys, "frozen", False):
        candidate_dirs.append(Path(sys.executable).resolve().parent)
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidate_dirs.append(Path(meipass))

    for directory in candidate_dirs:
        candidate = directory / executable_name
        if candidate.is_file():
            return str(candidate)

    resolved = shutil.which(executable_name) or shutil.which(tool_name)
    if resolved is not None:
        return resolved

    searched_dirs = ", ".join(str(path) for path in candidate_dirs)
    raise FileNotFoundError(
        f"{executable_name} was not found. Searched bundled directories: {searched_dirs}. "
        "Run `npm run build:ffmpeg` from the project root or set ORCESTR_FFMPEG_DIR."
    )
