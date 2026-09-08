#!/usr/bin/env python3
"""Run the security/round-trip contract against the packaged executable."""
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
default_resources = (
    root / "release" / "win-unpacked" / "resources"
    if sys.platform == "win32"
    else root / "release" / "mac-arm64" / "Mac PDF Editor.app" / "Contents" / "Resources"
)
resources = Path(os.environ.get("QA_APP_RESOURCES", str(default_resources)))
backend_name = "windows-pdf-backend.exe" if sys.platform == "win32" else "mac-pdf-backend"
backend = resources / "backend" / backend_name
if not backend.is_file():
    raise SystemExit(f"Build the {sys.platform} application before running packaged QA: {backend}")
env = os.environ.copy()
env["QA_BACKEND_EXECUTABLE"] = str(backend)
env["QA_FONTS_DIRECTORY"] = str(resources / "fonts")
subprocess.run(["node", "--test", "tests/security.test.cjs"], cwd=root, env=env, check=True)
