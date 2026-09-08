#!/usr/bin/env python3
"""Run the security/round-trip contract against the packaged executable."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
default_resources = (
    root / "release" / "win-unpacked" / "resources"
    if sys.platform == "win32"
    else root / "release" / "mac-arm64" / "Mac PDF Editor.app" / "Contents" / "Resources"
)
resources = Path(os.environ.get("QA_APP_RESOURCES", str(default_resources)))
backend_name = "windows-pdf-backend.exe" if sys.platform == "win32" else "mac-pdf-backend"
source_backend = resources / "backend" / backend_name
if not source_backend.is_file():
    raise SystemExit(f"Build the {sys.platform} application before running packaged QA: {source_backend}")

with tempfile.TemporaryDirectory(prefix="pdf-editor-packaged-") as temp_root:
    test_resources = Path(temp_root) / "Risorse app Àccentate"
    test_backend_directory = test_resources / "backend"
    test_backend_directory.mkdir(parents=True)
    backend = test_backend_directory / backend_name
    shutil.copy2(source_backend, backend)
    shutil.copytree(resources / "fonts", test_resources / "fonts")
    if sys.platform == "win32":
        helper = resources / "backend" / "windows_pdf_ocr.ps1"
        if helper.is_file():
            shutil.copy2(helper, test_backend_directory / helper.name)
    env = os.environ.copy()
    env["QA_BACKEND_EXECUTABLE"] = str(backend)
    env["QA_FONTS_DIRECTORY"] = str(test_resources / "fonts")
    subprocess.run(["node", "--test", "tests/security.test.cjs"], cwd=root, env=env, check=True)
