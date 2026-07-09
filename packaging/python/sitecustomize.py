"""Keeps Windows packaging independent from the optional WMI service."""

from __future__ import annotations

from collections import namedtuple
import os
import platform
import sys


if sys.platform == "win32":
    windows_version = sys.getwindowsversion()
    windows_release = str(windows_version.major)
    windows_version_text = (
        f"{windows_version.major}.{windows_version.minor}.{windows_version.build}"
    )
    windows_machine = os.environ.get("PROCESSOR_ARCHITECTURE", "AMD64")
    windows_uname_type = namedtuple(
        "windows_uname_result",
        "system node release version machine processor",
    )
    windows_uname = windows_uname_type(
        "Windows",
        os.environ.get("COMPUTERNAME", "localhost"),
        windows_release,
        windows_version_text,
        windows_machine,
        windows_machine,
    )

    def uname_without_wmi() -> tuple[str, str, str, str, str, str]:
        """Returns platform identity without querying WMI."""
        return windows_uname

    def win32_ver_without_wmi(
        release: str = "",
        version: str = "",
        csd: str = "",
        ptype: str = "",
    ) -> tuple[str, str, str, str]:
        """Reads the Windows version from the kernel without querying WMI."""
        return (
            release or windows_release,
            version or windows_version_text,
            csd,
            ptype,
        )

    platform.uname = uname_without_wmi
    platform.win32_ver = win32_ver_without_wmi
