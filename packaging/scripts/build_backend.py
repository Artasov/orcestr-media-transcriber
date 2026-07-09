from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
BACKEND_SRC_DIR = BACKEND_DIR / "src"
DIST_DIR = ROOT_DIR / "dist" / "backend"
BUILD_DIR = ROOT_DIR / "build" / "pyinstaller"
ENTRYPOINT = BACKEND_SRC_DIR / "media_transcriber" / "desktop_entry.py"
PACKAGING_PYTHON_DIR = ROOT_DIR / "packaging" / "python"
PLATFORM_RUNTIME_HOOK = PACKAGING_PYTHON_DIR / "sitecustomize.py"


def backend_binary_name() -> str:
    suffix = ".exe" if sys.platform == "win32" else ""
    return f"orcestr-media-backend{suffix}"


def main() -> None:
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    binary_path = DIST_DIR / backend_binary_name()
    if binary_path.exists():
        binary_path.unlink()

    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--onefile",
        "--name",
        "orcestr-media-backend",
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR / "work"),
        "--specpath",
        str(BUILD_DIR),
        "--paths",
        str(BACKEND_SRC_DIR),
        "--collect-submodules",
        "uvicorn",
        "--collect-submodules",
        "pydantic_settings",
        "--runtime-hook",
        str(PLATFORM_RUNTIME_HOOK),
        str(ENTRYPOINT),
    ]
    environment = os.environ.copy()
    python_path = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = os.pathsep.join(
        value for value in (str(PACKAGING_PYTHON_DIR), python_path) if value
    )
    subprocess.run(command, cwd=ROOT_DIR, env=environment, check=True)

    spec_file = BUILD_DIR / "orcestr-media-backend.spec"
    if spec_file.exists():
        spec_file.unlink()

    bundled_dir = DIST_DIR / "orcestr-media-backend"
    if bundled_dir.exists():
        shutil.rmtree(bundled_dir)

    if not binary_path.exists():
        raise SystemExit(f"Backend binary was not created: {binary_path}")


if __name__ == "__main__":
    main()
