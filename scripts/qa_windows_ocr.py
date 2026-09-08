#!/usr/bin/env python3
"""Exercise the real Windows OCR provider with a generated local image."""
import sys
import tempfile
from pathlib import Path

import fitz

from backend import main


if sys.platform != "win32":
    print("Windows OCR QA skipped outside Windows")
    raise SystemExit(0)

with tempfile.TemporaryDirectory(prefix="pdf-editor-windows-ocr-") as directory:
    image_path = Path(directory) / "ocr-source.png"
    document = fitz.open()
    page = document.new_page(width=800, height=300)
    page.insert_text((55, 160), "WINDOWS OCR 2026", fontname="helv", fontsize=58)
    page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(image_path)
    document.close()

    helper = main.ocr_helper_path()
    if helper is None:
        raise SystemExit("Windows OCR helper not found")
    observations = main.run_ocr_helper(helper, image_path, "en-US")
    recognized = " ".join(str(item.get("text", "")) for item in observations).upper()
    if "WINDOWS" not in recognized or "2026" not in recognized:
        raise SystemExit(f"Windows OCR did not recognize the regression text: {recognized!r}")
    print(f"Windows OCR verified with {helper.name}: {recognized}")
