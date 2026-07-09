from __future__ import annotations

import os
import socket
import threading

import uvicorn

from media_transcriber.config import get_settings
from media_transcriber.main import app


class DesktopParentMonitor:
    """Stops the packaged backend when its Tauri lifecycle socket closes."""

    def __init__(self, watch_port: int) -> None:
        self.watch_port = watch_port

    @classmethod
    def from_environment(cls) -> DesktopParentMonitor | None:
        """Builds the monitor from the port supplied by the desktop shell."""
        raw_port = os.environ.get("ORCESTR_DESKTOP_WATCH_PORT", "").strip()
        if not raw_port:
            return None
        try:
            watch_port = int(raw_port)
        except ValueError:
            return None
        if not 1 <= watch_port <= 65_535:
            return None
        return cls(watch_port)

    def start(self) -> None:
        """Starts parent monitoring on a daemon thread."""
        threading.Thread(
            target=self.watch,
            name="desktop-parent-monitor",
            daemon=True,
        ).start()

    def watch(self) -> None:
        """Terminates this process after the desktop lifecycle socket closes."""
        try:
            with socket.create_connection(("127.0.0.1", self.watch_port), timeout=10) as connection:
                connection.settimeout(None)
                while connection.recv(1):
                    pass
        finally:
            os._exit(0)


def main() -> None:
    parent_monitor = DesktopParentMonitor.from_environment()
    if parent_monitor is not None:
        parent_monitor.start()
    settings = get_settings()
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
