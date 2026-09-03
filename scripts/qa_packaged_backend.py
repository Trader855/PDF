#!/usr/bin/env python3
"""Run the security/round-trip contract against the packaged executable."""
import os
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parent.parent
resources = Path(os.environ.get("QA_APP_RESOURCES", str(root / "release/mac-arm64/Mac PDF Editor.app/Contents/Resources")))
backend = resources / "backend/mac-pdf-backend"
if not backend.is_file():
    raise SystemExit("Build the macOS application before running packaged QA")
env = os.environ.copy()
env["QA_BACKEND_EXECUTABLE"] = str(backend)
env["QA_FONTS_DIRECTORY"] = str(resources / "fonts")
subprocess.run(["node", "--test", "tests/security.test.cjs"], cwd=root, env=env, check=True)
