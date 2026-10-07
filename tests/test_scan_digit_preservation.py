import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz
from fastapi import HTTPException

from backend import main
from backend.scan_digits import (
    ScanPreservationError, apply_digit_corrections, numeric_changes,
    prepare_digit_corrections,
)


class ScanDigitTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="scan-digit-qa-")
        self.root = Path(self.directory.name)
        main.OCR_INSPECTION_CACHE.clear()

    def tearDown(self):
        main.OCR_INSPECTION_CACHE.clear()
        self.directory.cleanup()

    def fixture(self, text="DATA 05/08/2026 117,03", background=(1, 1, 1)):
        with fitz.open() as d:
            p = d.new_page(width=400, height=250)
            p.draw_rect(p.rect, fill=background, color=None)
            p.insert_text((30, 110), text, fontname="helv", fontsize=18)
            span = main.native_text_spans(p)[0]
            span.update(source="ocr", confidence=1.0, words=[
                {"text": word[4], "bbox": list(word[:4])} for word in p.get_text("words")
            ])
            png = p.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False).tobytes("png")
        source = self.root / "source.pdf"
        with fitz.open() as d:
            p = d.new_page(width=400, height=250)
            p.insert_image(p.rect, stream=png)
            d.save(source)
        return source, span

    def observation(self, span):
        def box(rect):
            x0, y0, x1, y1 = rect
            return [x0 / 400, 1 - y1 / 250, (x1 - x0) / 400, (y1 - y0) / 250]
        return {"text": span["text"], "confidence": 1.0, "bbox": box(span["bbox"]),
                "words": [{"text": w["text"], "bbox": box(w["bbox"])} for w in span["words"]]}

    def test_only_equal_length_ascii_digit_changes_are_accepted(self):
        self.assertEqual(numeric_changes("DATA 05/08/2026", "DATA 06/08/2027"), [6, 14])
        for old, new in [("5", "56"), ("DATA 5", "data 6"), ("5", "５"), ("5", "5"), ("1" * 17, "2" * 17)]:
            with self.subTest(old=old, new=new), self.assertRaises(ScanPreservationError):
                numeric_changes(old, new)

    def test_digit_changes_keep_every_pixel_outside_the_changed_cells(self):
        source, target = self.fixture()
        original = hashlib.sha256(source.read_bytes()).hexdigest()
        with fitz.open(source) as d:
            p = d[0]
            original_image = d.extract_image(p.get_images()[0][0])["image"]
            before = p.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            plans = prepare_digit_corrections(p, [target], target, target["text"].replace("05/", "06/"))
            self.assertEqual(len(plans), 1)
            apply_digit_corrections(p, plans)
            output = self.root / "corrected.pdf"
            d.save(output, garbage=4, deflate=True)
        with fitz.open(output) as d:
            after = d[0].get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            self.assertEqual(d[0].get_text(), "", "No unrelated fallback font or invisible text layer")
            self.assertIn(original_image, [d.extract_image(image[0])["image"] for image in d[0].get_images()],
                          "Visual correction retains the original scan; it must not claim secure redaction")
        a, b = before.samples, after.samples
        changed = 0
        for y in range(before.height):
            for x in range(before.width):
                offset = (y * before.width + x) * 3
                if a[offset:offset + 3] == b[offset:offset + 3]:
                    continue
                changed += 1
                self.assertTrue(any((item["cell"] + (-.5, -.5, .5, .5)).contains(fitz.Point(x / 2, y / 2)) for item in plans))
        self.assertGreater(changed, 0)
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), original)

    def test_missing_digit_has_no_automatic_font_fallback(self):
        source, target = self.fixture("DATA 05/08/2026")
        with fitz.open(source) as d, self.assertRaises(ScanPreservationError):
            prepare_digit_corrections(d[0], [target], target, "DATA 05/08/2029")

    def test_no_word_boxes_or_low_confidence_leave_the_scan_intact(self):
        source, target = self.fixture()
        for changed in ({**target, "words": []}, {**target, "confidence": .5}):
            with fitz.open(source) as d, self.assertRaises(ScanPreservationError):
                prepare_digit_corrections(d[0], [changed], changed, changed["text"].replace("05/", "06/"))

    def test_rotated_or_colored_scan_is_not_reconstructed_blindly(self):
        source, target = self.fixture()
        with fitz.open(source) as d, self.assertRaises(ScanPreservationError):
            d[0].set_rotation(90)
            prepare_digit_corrections(d[0], [target], target, target["text"].replace("05/", "06/"))
        source, target = self.fixture(background=(.9, .9, .9))
        with fitz.open(source) as d, self.assertRaises(ScanPreservationError):
            prepare_digit_corrections(d[0], [target], target, target["text"].replace("05/", "06/"))

    def test_failed_multidigit_preflight_does_not_modify_the_page(self):
        source, target = self.fixture("DATA 05/08/2026")
        with fitz.open(source) as d:
            before = d[0].get_pixmap().samples
            with self.assertRaises(ScanPreservationError):
                prepare_digit_corrections(d[0], [target], target, "DATA 06/08/2029")
            self.assertEqual(d[0].get_pixmap().samples, before)
            self.assertEqual(d[0].get_drawings(), [])

    def test_too_many_numeric_words_are_bounded_before_mutation(self):
        source, target = self.fixture()
        target["words"] = [{"text": "05/08/2026", "bbox": target["words"][1]["bbox"]}] * 129
        target["text"] = " ".join(["05/08/2026"] * 129)
        with fitz.open(source) as d:
            before = d[0].get_pixmap().samples
            with self.assertRaises(ScanPreservationError):
                prepare_digit_corrections(d[0], [target], target, target["text"].replace("05/", "06/", 1))
            self.assertEqual(d[0].get_pixmap().samples, before)

    def test_backend_requires_a_verified_original_selection_and_fixed_position(self):
        source, target = self.fixture()
        observation = self.observation(target)
        with patch.object(main, "ocr_helper_path", return_value=Path("fixture-helper")), patch.object(main, "run_ocr_helper", return_value=[observation]):
            inspected = main.inspect_text(main.InspectRequest(file_path=str(source)))["spans"][0]
            for payload in ({"original_text": "OTHER 05/08/2026"}, {"origin": (80, 200)}, {"size": 50}, {"confirm_font_substitution": True}):
                output = self.root / "should-not-exist.pdf"
                request = dict(file_path=str(source), output_path=str(output), bbox=inspected["bbox"],
                               origin=inspected["origin"], size=inspected["size"], source="ocr",
                               new_text=inspected["text"].replace("05/", "06/"), original_text=inspected["text"], preserve_scan_digits=True)
                request.update(payload)
                with self.subTest(payload=payload), self.assertRaises(HTTPException) as raised:
                    main.edit_text(main.EditTextRequest(**request))
                self.assertEqual(raised.exception.status_code, 422)
                self.assertFalse(output.exists())

    def test_backend_uses_server_ocr_boxes_not_client_supplied_glyphs(self):
        source, target = self.fixture()
        observation = self.observation(target)
        updated = {**observation, "text": observation["text"].replace("05/", "06/"),
                   "words": [{**w, "text": w["text"].replace("05/", "06/")} for w in observation["words"]]}
        with patch.object(main, "ocr_helper_path", return_value=Path("fixture-helper")), patch.object(main, "run_ocr_helper", side_effect=[[observation], [updated]]):
            span = main.inspect_text(main.InspectRequest(file_path=str(source)))["spans"][0]
            result = main.edit_text(main.EditTextRequest(file_path=str(source), output_path=str(self.root / "good.pdf"),
                bbox=span["bbox"], origin=span["origin"], size=span["size"], original_text=span["text"],
                new_text=span["text"].replace("05/", "06/"), source="ocr", preserve_scan_digits=True))
        self.assertEqual(result["edit_mode"], "scan_digits")
        self.assertEqual(result["changed_digits"], 1)

    def test_output_not_confirmed_by_ocr_is_not_committed(self):
        source, target = self.fixture()
        observation = self.observation(target)
        output = self.root / "unverified.pdf"
        before = source.read_bytes()
        with patch.object(main, "ocr_helper_path", return_value=Path("fixture-helper")), patch.object(main, "run_ocr_helper", return_value=[observation]):
            span = main.inspect_text(main.InspectRequest(file_path=str(source)))["spans"][0]
            with self.assertRaises(HTTPException) as raised:
                main.edit_text(main.EditTextRequest(file_path=str(source), output_path=str(output),
                    bbox=span["bbox"], origin=span["origin"], size=span["size"], original_text=span["text"],
                    new_text=span["text"].replace("05/", "06/"), source="ocr", preserve_scan_digits=True))
        self.assertEqual(raised.exception.status_code, 422)
        self.assertFalse(output.exists())
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(list(self.root.glob(".*.tmp.pdf")), [])


if __name__ == "__main__":
    unittest.main()
