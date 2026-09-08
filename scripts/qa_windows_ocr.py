#!/usr/bin/env python3
"""Exercise the real Windows OCR provider with a generated local image."""
import sys
import tempfile
import math
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import main


if sys.platform != "win32":
    print("Windows OCR QA skipped outside Windows")
    raise SystemExit(0)

with tempfile.TemporaryDirectory(prefix="pdf-editor-windows-ocr-") as root_directory:
    directory = Path(root_directory) / "Percorso OCR Àccentato"
    directory.mkdir()
    image_path = Path(directory) / "ocr-source.png"
    document = fitz.open()
    page = document.new_page(width=800, height=300)
    page.insert_text((55, 160), "WINDOWS OCR 2026", fontname="helv", fontsize=58)
    page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(image_path)
    document.close()

    helper = main.ocr_helper_path()
    if helper is None:
        raise SystemExit("Windows OCR helper not found")
    observations = main.run_ocr_helper(helper, image_path, "it-IT,en-US")
    recognized = " ".join(str(item.get("text", "")) for item in observations).upper()
    if "WINDOWS" not in recognized or "2026" not in recognized:
        raise SystemExit(f"Windows OCR did not recognize the regression text: {recognized!r}")
    for observation in observations:
        bbox = observation.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            raise SystemExit(f"Windows OCR returned an invalid bounding box: {bbox!r}")
        x, y, width, height = map(float, bbox)
        if not all(map(math.isfinite, (x, y, width, height))):
            raise SystemExit(f"Windows OCR returned a non-finite bounding box: {bbox!r}")
        if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1.01 or y + height > 1.01:
            raise SystemExit(f"Windows OCR returned an out-of-range bounding box: {bbox!r}")
    print(f"Windows OCR verified with {helper.name}: {recognized}")
