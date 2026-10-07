"""Synthetic regression cases for the three independent-review findings."""
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz
from fastapi import HTTPException

from backend import main


class FontEditSafetyTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="pdf-font-safety-")
        self.root = Path(self.directory.name)
        main.OCR_INSPECTION_CACHE.clear()

    def tearDown(self):
        main.OCR_INSPECTION_CACHE.clear()
        self.directory.cleanup()

    def native_fixture(self, font_name="AuditEmbedded-Bold", pages=1, simple=False):
        source = self.root / "native.pdf"
        with fitz.open() as doc:
            for _ in range(pages):
                page = doc.new_page(width=400, height=250)
                xref = page.insert_font(fontname="Original", fontfile=str(
                    main.bundled_fonts_directory() / "liberation/LiberationSans-Bold.ttf"), set_simple=simple)
                page.insert_text((40, 100), "05/08/2026", fontname="Original", fontsize=18)
                # A real embedded Type0 font with an unknown PDF face name,
                # not a customer PDF or a mocked font-coverage result.
                doc.xref_set_key(xref, "BaseFont", f"/{font_name}")
                children = re.findall(r"(\d+) 0 R", doc.xref_get_key(xref, "DescendantFonts")[1])
                for child in children or [str(xref)]:
                    doc.xref_set_key(int(child), "BaseFont", f"/{font_name}")
                    descriptor = doc.xref_get_key(int(child), "FontDescriptor")[1]
                    doc.xref_set_key(int(descriptor.split()[0]), "FontName", f"/{font_name}")
            doc.save(source)
        span = main.inspect_text(main.InspectRequest(file_path=str(source), include_ocr=False))["spans"][0]
        self.assertEqual(span["font"], re.sub(r"^[A-Z]{6}\+", "", font_name))
        return source, span

    def request(self, file_source, span, output="result.pdf", **changes):
        return main.EditTextRequest(**dict({
            "file_path": str(file_source), "output_path": str(self.root / output),
            "bbox": span["bbox"], "origin": span["origin"], "font": span["font"],
            "font_resource": span["font_resource"], "size": span["size"],
            "new_text": "06/08/2026", "source": "native",
        }, **changes))

    def test_native_substitution_requires_consent_and_creates_no_output(self):
        source, span = self.native_fixture()
        before = source.read_bytes()
        request = self.request(source, span)
        with self.assertRaises(HTTPException) as caught:
            main.edit_text(request)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail["status"], "font_substitution_required")
        self.assertEqual(caught.exception.detail["substitutions"][0]["proposed_font"], "Liberation Sans Bold")
        self.assertFalse(Path(request.output_path).exists())
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(list(self.root.glob(".*.tmp.pdf")), [])

    def test_consent_is_bound_to_the_actual_proposed_face(self):
        source, span = self.native_fixture()
        for confirmed in (None, "Liberation Serif", "Liberation Sans"):
            with self.subTest(confirmed=confirmed), self.assertRaises(HTTPException) as caught:
                main.edit_text(self.request(source, span, confirm_font_substitution=True,
                                             confirmed_substitute_font=confirmed))
            self.assertEqual(caught.exception.status_code, 409)
            self.assertFalse((self.root / "result.pdf").exists())
        result = main.edit_text(self.request(source, span, confirm_font_substitution=True,
                                            confirmed_substitute_font="Liberation Sans Bold"))
        self.assertEqual(result["font_used"], "Liberation Sans Bold")
        with fitz.open(result["output_path"]) as doc:
            self.assertIn("06/08/2026", doc[0].get_text())
            self.assertNotIn("05/08/2026", doc[0].get_text())
            self.assertTrue(any("Bold" in str(font[3]) for font in doc[0].get_fonts()))

    def test_batch_collects_all_substitutions_before_any_save(self):
        source, _ = self.native_fixture(pages=2)
        before = source.read_bytes()
        changes = []
        with fitz.open(source) as doc:
            for number, page in enumerate(doc):
                span = main.native_text_spans(page)[0]
                changes.append(main.BatchTextChange(page_num=number, bbox=span["bbox"], origin=span["origin"],
                                                    font=span["font"], size=span["size"]))
        request = main.BatchEditTextRequest(file_path=str(source), output_path=str(self.root / "batch.pdf"),
                                            old_text="05/08/2026", new_text="06/08/2026", changes=changes)
        with self.assertRaises(HTTPException) as caught:
            main.batch_edit_text(request)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual([item["index"] for item in caught.exception.detail["substitutions"]], [0, 1])
        self.assertEqual(source.read_bytes(), before)
        self.assertFalse(Path(request.output_path).exists())
        for change in changes:
            change.confirm_font_substitution = True
            change.confirmed_substitute_font = "Liberation Sans Bold"
        result = main.batch_edit_text(request)
        self.assertEqual(result["fonts_used"], ["Liberation Sans Bold"])
        with fitz.open(result["output_path"]) as doc:
            self.assertTrue(all("06/08/2026" in page.get_text() for page in doc))

    def test_literal_old_value_is_found_inside_a_longer_replacement(self):
        source, span = self.native_fixture()
        result = main.edit_text(self.request(source, span,
            new_text='05/08/202606/08/2026', confirm_font_substitution=True,
            confirmed_substitute_font='Liberation Sans Bold'))
        exact = main.find_repeated_text(main.FindRepeatedTextRequest(
            file_path=result['output_path'], text='05/08/2026'))
        literal = main.search_text(main.SearchTextRequest(
            file_path=result['output_path'], query='05/08/2026'))
        self.assertEqual(exact['matches'], [])
        self.assertEqual(len(literal['matches']), 1)
        self.assertFalse(literal['truncated'])

    def test_bold_face_never_matches_a_regular_resource(self):
        source, _ = self.native_fixture(font_name="Helvetica-Bold")
        with fitz.open(source) as doc:
            page = doc[0]
            page.insert_text((40, 150), "REGULAR", fontname="helv")
            self.assertIsNone(main.font_resource_for_span(page, "Helvetica-Bold", "6"))
            self.assertIsNone(main.font_resource_for_span(page, "", "6"))
            regular = main.font_resource_for_span(page, "Helvetica", "6")
            self.assertIsNotNone(regular)
            # A mismatched resource supplied by a stale client is rejected too.
            self.assertIsNone(main.requested_font_resource(page, regular, "6", expected_name="Helvetica-Bold"))
            resource, name = main.resolve_text_font(page, "Helvetica-Bold", regular, "6")
            self.assertNotEqual(resource, regular)
            self.assertEqual(name, "Liberation Sans Bold")

    def test_original_resource_reports_its_actual_name_not_an_alias(self):
        with fitz.open() as doc:
            page = doc.new_page()
            page.insert_text((40, 100), "6", fontname="hebo")
            resource, name = main.resolve_text_font(page, "ABCDEF+Helvetica-Bold", "hebo", "6")
            self.assertEqual(resource, "hebo")
            self.assertEqual(name, "Helvetica-Bold")

    def test_long_subset_font_name_keeps_its_full_identity_and_original_resource(self):
        name = "ABCDEF+TimesNewRomanPS-BoldItalicMT"
        source, span = self.native_fixture(name, simple=True)
        self.assertEqual(span["font"], "TimesNewRomanPS-BoldItalicMT")
        self.assertIsNotNone(span["font_resource"])
        result = main.edit_text(self.request(source, span))
        self.assertEqual(result["font_used"], span["font"])
        self.assertIn("06/08/2026", main.inspect_text(main.InspectRequest(file_path=result["output_path"]))["spans"][0]["text"])

    def test_clipped_name_mapping_is_not_a_partial_or_ambiguous_family_match(self):
        source, _ = self.native_fixture("ABCDEF+TimesNewRomanPS-BoldItalicMT", simple=True)
        with fitz.open(source) as doc:
            page = doc[0]
            self.assertEqual(main.canonical_span_font_name(page, "TimesNewRoman"), "TimesNewRoman")
            xref = page.insert_font(fontname="Second", fontfile=str(main.bundled_fonts_directory() / "liberation/LiberationSerif-BoldItalic.ttf"), set_simple=True)
            doc.xref_set_key(xref, "BaseFont", "/GHIJKL+TimesNewRomanPS-BoldItalOther")
            self.assertEqual(main.canonical_span_font_name(page, "TimesNewRomanPS-BoldItal"), "TimesNewRomanPS-BoldItal")

    def test_base14_batch_keeps_original_font_after_redaction_on_both_pages(self):
        source = self.root / "times.pdf"
        changes = []
        with fitz.open() as doc:
            for page_num in range(2):
                page = doc.new_page()
                page.insert_text((40, 100), "05/08/2026", fontname="tiro")
                page.insert_text((40, 150), "OTHER FONT", fontname="helv")
                span = main.native_text_spans(page)[0]
                changes.append(main.BatchTextChange(page_num=page_num, bbox=span["bbox"], origin=span["origin"],
                    font=span["font"], font_resource=span["font_resource"], size=span["size"]))
            doc.save(source)
        result = main.batch_edit_text(main.BatchEditTextRequest(file_path=str(source), output_path=str(self.root / "times-result.pdf"),
            old_text="05/08/2026", new_text="06/08/2026", changes=changes))
        self.assertEqual(result["fonts_used"], ["Times-Roman"])
        with fitz.open(result["output_path"]) as doc:
            for page in doc:
                span = next(item for item in main.native_text_spans(page) if item["text"] == "06/08/2026")
                self.assertEqual(span["font"], "Times-Roman")

    def scan_fixture(self, hidden=True):
        with fitz.open() as doc:
            page = doc.new_page(width=400, height=250)
            page.insert_text((40, 100), "DATA 05/08/2026", fontsize=18)
            span = main.native_text_spans(page)[0]
            png = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).tobytes("png")
        source = self.root / "searchable-scan.pdf"
        with fitz.open() as doc:
            page = doc.new_page(width=400, height=250)
            page.insert_image(page.rect, stream=png)
            if hidden:
                page.insert_text((40, 100), span["text"], fontsize=18, render_mode=3)
            doc.save(source)
        x0, y0, x1, y1 = span["bbox"]
        observation = {"text": span["text"], "confidence": 1,
                       "bbox": [x0 / 400, 1 - y1 / 250, (x1 - x0) / 400, (y1 - y0) / 250]}
        return source, span, observation

    def test_invisible_ocr_is_not_exposed_as_native_and_does_not_suppress_real_ocr(self):
        source, span, observation = self.scan_fixture()
        with fitz.open(source) as doc:
            self.assertIn(span["text"], doc[0].get_text(), "Search remains supported")
            self.assertEqual(main.native_text_spans(doc[0]), [])
        with patch.object(main, "ocr_helper_path", return_value=Path("fixture-helper")), \
             patch.object(main, "run_ocr_helper", return_value=[observation]):
            inspected = main.inspect_text(main.InspectRequest(file_path=str(source)))
        self.assertEqual(len(inspected["spans"]), 1)
        self.assertEqual(inspected["spans"][0]["source"], "ocr")
        self.assertEqual(inspected["spans"][0]["font"], "")

    def test_stale_native_single_and_batch_requests_cannot_overprint_hidden_ocr(self):
        source, span, _ = self.scan_fixture()
        before = source.read_bytes()
        request = self.request(source, span)
        with self.assertRaises(HTTPException) as caught:
            main.edit_text(request)
        self.assertEqual(caught.exception.status_code, 422, str(caught.exception.detail))
        self.assertIn("OCR invisibile", caught.exception.detail)
        with self.assertRaises(HTTPException) as caught:
            main.batch_edit_text(main.BatchEditTextRequest(file_path=str(source), output_path=request.output_path,
                old_text=span["text"], new_text="DATA 06/08/2026", changes=[main.BatchTextChange(
                    page_num=0, bbox=span["bbox"], origin=span["origin"], font="Helvetica", size=18)]))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(source.read_bytes(), before)
        self.assertFalse(Path(request.output_path).exists())

    def test_fragmented_hidden_ocr_and_conservative_digits_fail_without_output(self):
        source, span, _ = self.scan_fixture(hidden=False)
        fragmented = self.root / "fragmented.pdf"
        with fitz.open(source) as doc:
            for index, word in enumerate(["05", "08", "2026"]):
                doc[0].insert_text((40 + index * 70, 100), word, fontsize=18, render_mode=3)
            doc.save(fragmented)
        with self.assertRaises(HTTPException) as caught:
            main.edit_text(self.request(fragmented, span))
        self.assertEqual(caught.exception.status_code, 422)
        with self.assertRaises(HTTPException) as caught:
            main.edit_text(self.request(fragmented, span, source="ocr", preserve_scan_digits=True, original_text=span["text"]))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("vecchio valore", caught.exception.detail)
        self.assertFalse((self.root / "result.pdf").exists())
        with fitz.open(fragmented) as doc:
            self.assertIn("05", doc[0].get_text(), "Rejected operation leaves the original searchable layer untouched")

    def test_late_batch_font_conflict_is_atomic_not_misindexed_consent(self):
        source, span = self.native_fixture(pages=2)
        before = source.read_bytes()
        changes = [main.BatchTextChange(page_num=index, bbox=span["bbox"], origin=span["origin"],
            font=span["font"], size=span["size"], confirm_font_substitution=True,
            confirmed_substitute_font="Liberation Sans Bold") for index in range(2)]
        resolver = main.resolve_edit_text_font
        calls = 0
        def changed_resources(*args):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise HTTPException(status_code=409, detail={"status": "font_substitution_required",
                    "substitutions": [{"index": 0, "requested_font": span["font"], "proposed_font": "Other"}]})
            return resolver(*args)
        output = self.root / "late-conflict.pdf"
        with patch.object(main, "resolve_edit_text_font", side_effect=changed_resources), self.assertRaises(HTTPException) as caught:
            main.batch_edit_text(main.BatchEditTextRequest(file_path=str(source), output_path=str(output),
                old_text="05/08/2026", new_text="06/08/2026", changes=changes))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertIn("Nessuna modifica salvata", caught.exception.detail)
        self.assertFalse(output.exists())
        self.assertEqual(source.read_bytes(), before)

    def test_paint_flags_are_bound_to_the_pinned_engine(self):
        self.assertEqual(fitz.VersionBind, "1.26.5")

    def test_searchable_scan_rewrite_matches_image_only_scan_without_overprint(self):
        source, span, _ = self.scan_fixture()
        request = self.request(source, span, source="ocr", font="Liberation Sans", size=18,
                               new_text="DATA 06/08/2026", confirm_font_substitution=True)
        searchable = main.edit_text(request)
        source, span, _ = self.scan_fixture(hidden=False)
        image_only = main.edit_text(self.request(source, span, output="image-only.pdf", source="ocr",
            font="Liberation Sans", size=18, new_text="DATA 06/08/2026", confirm_font_substitution=True))
        with fitz.open(searchable["output_path"]) as a, fitz.open(image_only["output_path"]) as b:
            self.assertEqual(a[0].get_pixmap(matrix=fitz.Matrix(2, 2)).samples,
                             b[0].get_pixmap(matrix=fitz.Matrix(2, 2)).samples)
            self.assertNotIn("05/08/2026", a[0].get_text())

    def test_fill_and_stroke_text_remain_selectable_but_transparent_text_does_not(self):
        with fitz.open() as doc:
            page = doc.new_page()
            page.insert_text((40, 80), "FILLED", render_mode=0)
            page.insert_text((40, 110), "STROKED", render_mode=1)
            page.insert_text((40, 140), "ARTIFICIAL BOLD", render_mode=2)
            page.insert_text((40, 170), "TRANSPARENT", fill_opacity=0)
            page.insert_text((40, 200), "HIDDEN", render_mode=3)
            self.assertEqual([span["text"] for span in main.native_text_spans(page)],
                             ["FILLED", "STROKED", "ARTIFICIAL BOLD"])


if __name__ == "__main__":
    unittest.main()
