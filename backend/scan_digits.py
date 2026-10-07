"""Conservative, local digit corrections in scans. This is NOT OCR font recovery.

The underlying scan is retained. Only isolated digits of equal-length numeric
tokens can be visually corrected, using compatible glyph images from the same
page. This is NOT secure redaction: original pixels remain under the overlays.
All checks and donor capture happen before mutation. Ambiguity is an error,
never permission to fall back to a different font.
"""
import math
import re
from collections import Counter
from typing import Any, Dict, List, Optional

import fitz


class ScanPreservationError(ValueError):
    pass


NUMERIC_TOKEN = re.compile(r"[0-9/.,:-]{1,32}\Z")
SCALE = 4
MAX_WORD_PIXELS = 180_000
MAX_CHANGED_DIGITS = 16
MAX_NUMERIC_WORDS = 128
MAX_CROP_PIXELS = 3_000_000
MAX_SHAPE_COMPARISONS = 20_000
OCR_CROP_MARGIN = 2


def numeric_changes(old: str, new: str) -> List[int]:
    if not old or len(old) != len(new) or len(old) > 2000:
        raise ScanPreservationError("Si possono correggere solo cifre senza cambiare la lunghezza del testo.")
    changed = [i for i, (before, after) in enumerate(zip(old, new)) if before != after]
    if not changed or len(changed) > MAX_CHANGED_DIGITS or any(
        old[i] not in "0123456789" or new[i] not in "0123456789" for i in changed
    ):
        raise ScanPreservationError("Questa modalità conserva la scansione e corregge solo cifre, non lettere o impaginazione.")
    return changed


def _glyphs(page: fitz.Page, word: Dict[str, Any]) -> List[Optional[Dict[str, Any]]]:
    text = word.get("text", "")
    if not isinstance(text, str) or not NUMERIC_TOKEN.fullmatch(text):
        return []
    try:
        rect = fitz.Rect(word["bbox"])
    except (KeyError, TypeError, ValueError):
        return []
    if not all(math.isfinite(v) for v in rect) or rect.is_empty or not page.rect.contains(rect):
        return []
    ocr_rect = fitz.Rect(rect)
    crop = (rect + (-OCR_CROP_MARGIN, -OCR_CROP_MARGIN, OCR_CROP_MARGIN, OCR_CROP_MARGIN)) & page.rect
    if rect.width > 300 or rect.height > 60 or math.ceil(crop.width * SCALE + 2) * math.ceil(crop.height * SCALE + 2) > MAX_WORD_PIXELS:
        return []
    pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), clip=crop, colorspace=fitz.csRGB, alpha=False)
    raw = pix.samples
    colors = Counter(tuple(raw[i:i + 3]) for i in range(0, len(raw), 3))
    # Patterned/colored paper requires a different background reconstruction.
    if colors.most_common(1)[0][0] != (255, 255, 255):
        return []
    rows = [bytearray(sum(raw[(y * pix.width + x) * 3:(y * pix.width + x) * 3 + 3]) < 510
                      for x in range(pix.width)) for y in range(pix.height)]
    # A tight/incorrect OCR box must not leave the top, bottom or side of the
    # old glyph behind. Inspect a bounded margin before choosing any donor or
    # mask, and reject rather than infer missing strokes or expand over ink.
    if any(rows[0]) or any(rows[-1]) or any(row[0] or row[-1] for row in rows):
        return []
    for y, row in enumerate(rows):
        for x, ink in enumerate(row):
            if ink and not ocr_rect.contains(fitz.Point((pix.x + x + .5) / SCALE, (pix.y + y + .5) / SCALE)):
                return []
    counts = [sum(row) for row in rows]
    cutoff = max(2, max(counts) * .02)
    active = [y for y, count in enumerate(counts) if count >= cutoff]
    if not active:
        return []
    top, bottom = min(active), max(active) + 1
    columns = [sum(rows[y][x] for y in range(top, bottom)) for x in range(pix.width)]
    runs, start = [], None
    for x, count in enumerate(columns + [0]):
        if count and start is None:
            start = x
        elif not count and start is not None:
            runs.append((start, x))
            start = None
    if not runs:
        return []
    # A margin must not become an extra letter from a neighboring word. Retain
    # only components centered inside the original word box.
    runs = [(left, right) for left, right in runs
            if ocr_rect.x0 <= (pix.x + (left + right) / 2) / SCALE <= ocr_rect.x1]
    if not runs:
        return []
    run_bounds = []
    for left, right in runs:
        ys = [y for y in range(top, bottom) if any(rows[y][left:right])]
        run_bounds.append((min(ys), max(ys) + 1))
    max_height = max(b - t for t, b in run_bounds)
    assignments = []
    if len(runs) == len(text):
        assignments = list(enumerate(range(len(text))))
    elif len(runs) != len(text):
        # Touching digits are never split by guesswork. A clearly isolated tail
        # may still be corrected; stop at the first merged/ambiguous component.
        index = len(text) - 1
        for run_index in range(len(runs) - 1, -1, -1):
            left, right = runs[run_index]
            t, b = run_bounds[run_index]
            height = b - t
            char = text[index]
            valid = height < max_height * .55 if char in ".," else (
                height >= max_height * .7 and right - left < height * .85
            )
            if not valid:
                break
            assignments.append((run_index, index))
            index -= 1
            if index < 0:
                break
    result: List[Optional[Dict[str, Any]]] = [None] * len(text)
    for run_index, text_index in assignments:
        left, right = runs[run_index]
        t, b = run_bounds[run_index]
        char = text[text_index]
        if char.isdigit() and (b - t < max_height * .7 or right - left >= (b - t) * .85):
            continue
        ink = fitz.Rect((pix.x + left) / SCALE, (pix.y + t) / SCALE,
                        (pix.x + right) / SCALE, (pix.y + b) / SCALE)
        cell_left = min(rect.x0, ink.x0 - .25) if run_index == 0 else (pix.x + (runs[run_index - 1][1] + left) / 2) / SCALE
        cell_right = max(rect.x1, ink.x1 + .25) if run_index == len(runs) - 1 else (pix.x + (right + runs[run_index + 1][0]) / 2) / SCALE
        shape = [bytearray(rows[y][left:right]) for y in range(t, b)]
        result[text_index] = {"char": char, "ink": ink, "cell": fitz.Rect(cell_left, rect.y0, cell_right, rect.y1), "shape": shape}
    return result


def _similarity(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    def normalized(glyph):
        if "normalized_shape" in glyph:
            return glyph["normalized_shape"]
        rows = glyph["shape"]
        h, w = len(rows), len(rows[0])
        glyph["normalized_shape"] = [rows[min(h - 1, int((y + .5) * h / 28))][min(w - 1, int((x + .5) * w / 20))]
                                     for y in range(28) for x in range(20)]
        return glyph["normalized_shape"]
    aa, bb = normalized(a), normalized(b)
    area_a, area_b = sum(aa), sum(bb)
    if not area_a or not area_b or not .8 <= area_a / area_b <= 1.25:
        return 0.0
    intersection = sum(x and y for x, y in zip(aa, bb))
    return 2 * intersection / (area_a + area_b)


def _safe_cell(page: fitz.Page, cell: fitz.Rect, destination: fitz.Rect) -> Optional[fitz.Rect]:
    if cell.contains(destination):
        return cell
    expanded = cell | destination
    if not page.rect.contains(expanded) or cell.x0 - expanded.x0 > 1.5 or expanded.x1 - cell.x1 > 1.5:
        return None
    pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), clip=expanded, colorspace=fitz.csRGB, alpha=False)
    raw = pix.samples
    for y in range(pix.height):
        for x in range(pix.width):
            point = fitz.Point((pix.x + x + .5) / SCALE, (pix.y + y + .5) / SCALE)
            if expanded.contains(point) and not cell.contains(point):
                offset = (y * pix.width + x) * 3
                if min(raw[offset:offset + 3]) < 250:
                    return None
    return expanded


def prepare_digit_corrections(page: fitz.Page, spans: List[Dict[str, Any]],
                              target: Dict[str, Any], new_text: str) -> List[Dict[str, Any]]:
    old_text = target["text"]
    changes = numeric_changes(old_text, new_text)
    if page.rotation != 0:
        raise ScanPreservationError("La correzione conservativa delle scansioni ruotate non è ancora disponibile.")
    target_index = next((i for i, span in enumerate(spans) if span is target), None)
    if target_index is None:
        raise ScanPreservationError("Selezione OCR non verificata.")
    words = []
    numeric_count, crop_pixels = 0, 0
    nearby = sorted(enumerate(spans), key=lambda item: abs(item[0] - target_index))
    for line_index, span in nearby:
        if abs(line_index - target_index) > 12:
            break
        if span.get("source") != "ocr" or span.get("confidence", 0) < .8:
            continue
        cursor = 0
        for word in span.get("words", [])[:300]:
            text = word.get("text", "")
            if not text:
                continue
            offset = span["text"].find(text, cursor)
            if offset < 0:
                continue
            cursor = offset + len(text)
            if not NUMERIC_TOKEN.fullmatch(text):
                continue
            numeric_count += 1
            word_rect = fitz.Rect(word["bbox"])
            if not all(math.isfinite(v) for v in word_rect) or word_rect.is_empty:
                continue
            crop_pixels += math.ceil((word_rect.width + 2 * OCR_CROP_MARGIN) * SCALE + 2) * math.ceil((word_rect.height + 2 * OCR_CROP_MARGIN) * SCALE + 2)
            if numeric_count > MAX_NUMERIC_WORDS or crop_pixels > MAX_CROP_PIXELS:
                raise ScanPreservationError("La zona OCR è troppo complessa per una correzione conservativa sicura.")
            glyphs = _glyphs(page, word)
            if glyphs:
                words.append({"span": span, "line": line_index, "offset": offset, "text": text, "glyphs": glyphs})
    plans = []
    comparison_count = 0
    style_scores = {}
    for index in changes:
        source = next((word for word in words if word["span"] is target
                       and word["offset"] <= index < word["offset"] + len(word["text"])), None)
        glyph = source["glyphs"][index - source["offset"]] if source else None
        if glyph is None:
            raise ScanPreservationError("La cifra da cambiare non è isolabile con sicurezza nella scansione.")
        candidates = []
        for word in words:
            if abs(word["line"] - source["line"]) > 12:
                continue
            # Compare unchanged digits shared by the two numeric words. Their
            # shapes, not a guessed font name, must support the style match.
            score_key = (id(source), id(word))
            comparisons = style_scores.get(score_key)
            if comparisons is None:
                shared = {a["char"] for a in source["glyphs"] if a and a["char"].isdigit()} & {
                    b["char"] for b in word["glyphs"] if b and b["char"].isdigit()}
                # Different occurrences in a noisy scan have different edge
                # pixels. Compare a complete occurrence of EACH shared digit.
                comparisons = []
                for char in shared:
                    aa = [a for a in source["glyphs"] if a and a["char"] == char]
                    bb = [b for b in word["glyphs"] if b and b["char"] == char]
                    comparison_count += len(aa) * len(bb)
                    if comparison_count > MAX_SHAPE_COMPARISONS:
                        raise ScanPreservationError("Troppi campioni ambigui: correzione conservativa interrotta.")
                    comparisons.append(max(_similarity(a, b) for a in aa for b in bb))
                style_scores[score_key] = comparisons
            if not comparisons or sum(comparisons) / len(comparisons) < .80:
                continue
            for donor in word["glyphs"]:
                if donor is None or donor["char"] != new_text[index] or abs(donor["ink"].height / glyph["ink"].height - 1) > .12:
                    continue
                scale = glyph["ink"].height / donor["ink"].height
                # Preserve the donor's proportions. A <=5% uniform reduction
                # is allowed to fit a slightly narrower cell, not a squeeze or
                # expansion into neighboring ink.
                scale = min(scale, glyph["cell"].width / donor["ink"].width)
                height = donor["ink"].height * scale
                if height < glyph["ink"].height * .95:
                    continue
                width = donor["ink"].width * scale
                center = (glyph["ink"].x0 + glyph["ink"].x1) / 2
                left = max(glyph["cell"].x0, min(center - width / 2, glyph["cell"].x1 - width))
                destination = fitz.Rect(left, glyph["ink"].y1 - height, left + width, glyph["ink"].y1)
                cell = _safe_cell(page, glyph["cell"], destination)
                if cell is None:
                    continue
                candidates.append((abs(word["line"] - source["line"]), -sum(comparisons) / len(comparisons), donor, destination, cell))
        if not candidates:
            raise ScanPreservationError(f"Manca un campione compatibile della cifra {new_text[index]}: nessun font è stato sostituito.")
        _, _, donor, destination, cell = min(candidates, key=lambda item: item[:2])
        stream = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), clip=donor["ink"], colorspace=fitz.csRGB, alpha=False).tobytes("png")
        plans.append({"cell": cell, "destination": destination, "stream": stream})
    return plans


def apply_digit_corrections(page: fitz.Page, plans: List[Dict[str, Any]]) -> None:
    for plan in plans:
        # Image redaction rounds the mask to source-image pixels and can fade a
        # neighboring digit in a low-resolution scan. A precise vector mask
        # preserves those neighbors. Original pixels remain recoverable: this
        # deliberately does NOT offer permanent removal of confidential data.
        page.draw_rect(plan["cell"], color=None, fill=(1, 1, 1), overlay=True)
    for plan in plans:
        page.insert_image(plan["destination"], stream=plan["stream"], overlay=True)
