import base64
import os
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from typing import Optional

import fitz
from fastapi import HTTPException

from backend import main


EDITOR_BASELINE = (
    "0123456789 "
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ "
    "abcdefghijklmnopqrstuvwxyz "
    "àèéìòù ÀÈÉÌÒÙ € % + = - . , ; : ! ? ( ) / [ ] { } @ # & *"
)


def create_basic_pdf(path: Path, pages: int = 2) -> None:
    document = fitz.open()
    for index in range(pages):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), f"PAGINA {index + 1}", fontname="helv", fontsize=14)
        page.insert_text((72, 110), "DATA INCASSO", fontname="helv", fontsize=11)
        page.insert_text((180, 110), "05/08/2026", fontname="helv", fontsize=11)
    document.save(path)
    document.close()


def page_text(path: Path, page_num: int = 0) -> str:
    with fitz.open(path) as document:
        return document[page_num].get_text()


def solid_rgb_png(width: int = 20, height: int = 20) -> bytes:
    """Crea una piccola PNG valida senza dipendenze di test aggiuntive."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        checksum = zlib.crc32(kind + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", checksum)

    scanline = b"\x00" + bytes((30, 110, 220)) * width
    raw_pixels = scanline * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw_pixels))
        + chunk(b"IEND", b"")
    )


class BackendRegressionCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_directory = tempfile.TemporaryDirectory(prefix="mac-pdf-editor-qa-")
        self.temp_path = Path(self.temp_directory.name)
        self.source = self.temp_path / "source.pdf"
        create_basic_pdf(self.source)

    def tearDown(self) -> None:
        self.temp_directory.cleanup()

    def output(self, name: str) -> Path:
        return self.temp_path / name

    def assert_valid_pdf(self, path: Path, pages: Optional[int] = None) -> fitz.Document:
        self.assertTrue(path.is_file(), f"PDF non creato: {path}")
        document = fitz.open(path)
        self.assertFalse(document.needs_pass)
        if pages is not None:
            self.assertEqual(document.page_count, pages)
        return document


class FontCoverageTests(BackendRegressionCase):
    def test_every_bundled_font_covers_the_editor_baseline(self) -> None:
        checked = 0
        for family in main.BUNDLED_FONT_CATALOG:
            for style in ("regular", "bold", "italic", "bold_italic"):
                selected = main.bundled_font_match(
                    f"{family['family']}{main.FONT_STYLE_LABELS[style]}"
                )
                self.assertIsNotNone(selected)
                self.assertTrue(
                    main.font_file_supports_text(selected["path"], EDITOR_BASELINE),
                    f"Glifi di base mancanti in {selected['label']}",
                )
                checked += 1
        self.assertEqual(checked, 20)

    def test_common_aliases_and_styles_choose_the_expected_family(self) -> None:
        expected = {
            "FranklinGothic-Book": ("Liberation Sans", "regular"),
            "FranklinGothic-Demi": ("Liberation Sans", "bold"),
            "Arial Bold Italic": ("Liberation Sans", "bold_italic"),
            "Times New Roman": ("Liberation Serif", "regular"),
            "Courier New Italic": ("Liberation Mono", "italic"),
            "Calibri Bold": ("Carlito", "bold"),
            "Cambria Italic": ("Caladea", "italic"),
        }
        for requested, wanted in expected.items():
            with self.subTest(requested=requested):
                selected = main.bundled_font_match(requested)
                self.assertIsNotNone(selected)
                self.assertEqual((selected["family"], selected["style"]), wanted)

    def test_add_text_round_trip_preserves_digits_letters_accents_and_symbols(self) -> None:
        output = self.output("all-characters.pdf")
        result = main.add_text(
            main.AddTextRequest(
                file_path=str(self.source),
                output_path=str(output),
                page_num=0,
                origin=(50, 180),
                new_text=EDITOR_BASELINE,
                font="FranklinGothic-Book",
                size=8,
                color=0,
            )
        )
        self.assertEqual(result["font_used"], "Liberation Sans")
        document = self.assert_valid_pdf(output, pages=2)
        extracted = document[0].get_text()
        document.close()
        self.assertIn(EDITOR_BASELINE, extracted.replace("\n", " "))

    def test_missing_glyph_in_original_resource_triggers_safe_fallback(self) -> None:
        source = self.output("incomplete-font.pdf")
        document = fitz.open()
        page = document.new_page()
        page.insert_text((72, 72), "a", fontname="zadb", fontsize=12)
        document.save(source)
        document.close()

        with fitz.open(source) as document:
            resource = next(
                font[4]
                for font in document[0].get_fonts(full=True)
                if "zapf" in str(font[3]).casefold()
            )

        output = self.output("fallback-number-6.pdf")
        result = main.add_text(
            main.AddTextRequest(
                file_path=str(source),
                output_path=str(output),
                origin=(72, 120),
                new_text="06/08/2026",
                font="FranklinGothic-Book",
                font_resource=resource,
                size=12,
            )
        )
        self.assertEqual(result["font_used"], "Liberation Sans")
        self.assertIn("06/08/2026", page_text(output))

    def test_unsupported_character_is_rejected_before_creating_output(self) -> None:
        output = self.output("must-not-exist.pdf")
        with self.assertRaises(HTTPException) as raised:
            main.add_text(
                main.AddTextRequest(
                    file_path=str(self.source),
                    output_path=str(output),
                    origin=(72, 160),
                    new_text="Carattere non supportato: 😀",
                    font="FranklinGothic-Book",
                    size=11,
                )
            )
        self.assertEqual(raised.exception.status_code, 422)
        self.assertFalse(output.exists())


class TextEditingTests(BackendRegressionCase):
    def date_span(self, path: Path) -> dict:
        result = main.inspect_text(main.InspectRequest(file_path=str(path), page_num=0))
        return next(span for span in result["spans"] if span["text"] == "05/08/2026")

    def test_inspect_edit_save_reopen_and_edit_again(self) -> None:
        span = self.date_span(self.source)
        first_output = self.output("date-06.pdf")
        first = main.edit_text(
            main.EditTextRequest(
                file_path=str(self.source),
                output_path=str(first_output),
                bbox=span["bbox"],
                origin=span["origin"],
                new_text="06/08/2026",
                font=span["font"],
                font_resource=span["font_resource"],
                size=span["size"],
                color=span["color"],
            )
        )
        self.assertEqual(first["status"], "ok")
        self.assertIn("06/08/2026", page_text(first_output))
        self.assertNotIn("05/08/2026", page_text(first_output))

        inspected = main.inspect_text(
            main.InspectRequest(file_path=str(first_output), page_num=0)
        )
        changed_span = next(
            span for span in inspected["spans"] if span["text"] == "06/08/2026"
        )
        second_output = self.output("date-31.pdf")
        main.edit_text(
            main.EditTextRequest(
                file_path=str(first_output),
                output_path=str(second_output),
                bbox=changed_span["bbox"],
                origin=changed_span["origin"],
                new_text="31/12/2029",
                font=changed_span["font"],
                font_resource=changed_span["font_resource"],
                size=changed_span["size"],
                color=changed_span["color"],
            )
        )
        text = page_text(second_output)
        self.assertIn("31/12/2029", text)
        self.assertNotIn("06/08/2026", text)

    def test_document_search_finds_partial_text_on_every_page(self) -> None:
        found = main.search_text(
            main.SearchTextRequest(file_path=str(self.source), query="incasso")
        )
        self.assertEqual(found["page_count"], 2)
        self.assertEqual(len(found["matches"]), 2)
        self.assertEqual({match["page_num"] for match in found["matches"]}, {0, 1})
        self.assertFalse(found["truncated"])
        self.assertTrue(all(len(match["bbox"]) == 4 for match in found["matches"]))

    def test_document_search_respects_the_result_limit(self) -> None:
        found = main.search_text(
            main.SearchTextRequest(file_path=str(self.source), query="PAGINA", max_results=1)
        )
        self.assertEqual(len(found["matches"]), 1)
        self.assertTrue(found["truncated"])

    def test_failed_edit_does_not_remove_the_original_text(self) -> None:
        span = self.date_span(self.source)
        output = self.output("failed-edit.pdf")
        with self.assertRaises(HTTPException) as raised:
            main.edit_text(
                main.EditTextRequest(
                    file_path=str(self.source),
                    output_path=str(output),
                    bbox=span["bbox"],
                    origin=span["origin"],
                    new_text="😀",
                    font=span["font"],
                    font_resource=span["font_resource"],
                    size=span["size"],
                    color=span["color"],
                )
            )
        self.assertEqual(raised.exception.status_code, 422)
        self.assertFalse(output.exists())
        self.assertIn("05/08/2026", page_text(self.source))

    def test_empty_replacement_deletes_text_and_keeps_pdf_valid(self) -> None:
        span = self.date_span(self.source)
        output = self.output("deleted-date.pdf")
        main.edit_text(
            main.EditTextRequest(
                file_path=str(self.source),
                output_path=str(output),
                bbox=span["bbox"],
                origin=span["origin"],
                new_text="",
                font=span["font"],
                font_resource=span["font_resource"],
                size=span["size"],
                color=span["color"],
            )
        )
        document = self.assert_valid_pdf(output, pages=2)
        self.assertNotIn("05/08/2026", document[0].get_text())
        document.close()

    def test_coherent_edit_finds_and_replaces_repeated_text_atomically(self) -> None:
        found = main.find_repeated_text(
            main.FindRepeatedTextRequest(
                file_path=str(self.source),
                text="05/08/2026",
                include_ocr=False,
            )
        )
        self.assertEqual(found["page_count"], 2)
        self.assertEqual(len(found["matches"]), 2)
        self.assertEqual({match["page_num"] for match in found["matches"]}, {0, 1})
        self.assertTrue(all("DATA INCASSO" in match["context"] for match in found["matches"]))

        changes = [main.BatchTextChange(**match) for match in found["matches"]]
        output = self.output("coherent-date.pdf")
        result = main.batch_edit_text(
            main.BatchEditTextRequest(
                file_path=str(self.source),
                output_path=str(output),
                old_text="05/08/2026",
                new_text="06/08/2026",
                changes=changes,
            )
        )
        self.assertEqual(result["changed_count"], 2)
        document = self.assert_valid_pdf(output, pages=2)
        for page in document:
            text = page.get_text()
            self.assertIn("06/08/2026", text)
            self.assertNotIn("05/08/2026", text)
        document.close()

    def test_coherent_edit_preflight_failure_leaves_source_intact(self) -> None:
        found = main.find_repeated_text(
            main.FindRepeatedTextRequest(
                file_path=str(self.source), text="05/08/2026", include_ocr=False
            )
        )
        output = self.output("coherent-must-not-exist.pdf")
        with self.assertRaises(HTTPException) as raised:
            main.batch_edit_text(
                main.BatchEditTextRequest(
                    file_path=str(self.source),
                    output_path=str(output),
                    old_text="05/08/2026",
                    new_text="😀",
                    changes=[main.BatchTextChange(**match) for match in found["matches"]],
                )
            )
        self.assertEqual(raised.exception.status_code, 422)
        self.assertFalse(output.exists())
        self.assertIn("05/08/2026", page_text(self.source, 0))
        self.assertIn("05/08/2026", page_text(self.source, 1))


class CorePdfSmokeTests(BackendRegressionCase):
    def test_page_operations_and_reordering_round_trip(self) -> None:
        duplicate = self.output("duplicate.pdf")
        main.page_operation(
            main.PageOperationRequest(
                file_path=str(self.source), output_path=str(duplicate), page_num=0, action="duplicate"
            )
        )
        self.assert_valid_pdf(duplicate, pages=3).close()

        reordered = self.output("reordered.pdf")
        main.reorder_pages(
            main.ReorderPagesRequest(
                file_path=str(duplicate), output_path=str(reordered), order=[2, 0, 1]
            )
        )
        document = self.assert_valid_pdf(reordered, pages=3)
        self.assertIn("PAGINA 2", document[0].get_text())
        document.close()

        rotated = self.output("rotated.pdf")
        main.page_operation(
            main.PageOperationRequest(
                file_path=str(reordered), output_path=str(rotated), page_num=0, action="rotate"
            )
        )
        document = self.assert_valid_pdf(rotated, pages=3)
        self.assertEqual(document[0].rotation, 90)
        document.close()

        extracted = self.output("extracted.pdf")
        main.page_operation(
            main.PageOperationRequest(
                file_path=str(rotated), output_path=str(extracted), page_num=0, action="extract"
            )
        )
        self.assert_valid_pdf(extracted, pages=1).close()

    def test_annotation_image_and_form_survive_save_and_reopen(self) -> None:
        annotated = self.output("annotated.pdf")
        main.add_annotation(
            main.AnnotationRequest(
                file_path=str(self.source),
                output_path=str(annotated),
                kind="rectangle",
                rect=(60, 130, 220, 180),
            )
        )
        with fitz.open(annotated) as document:
            self.assertIsNotNone(document[0].first_annot)

        image_added = self.output("image.pdf")
        image_bytes = solid_rgb_png()
        main.add_image(
            main.AddImageRequest(
                file_path=str(annotated),
                output_path=str(image_added),
                rect=(250, 130, 300, 180),
                image_data="data:image/png;base64," + base64.b64encode(image_bytes).decode("ascii"),
            )
        )
        with fitz.open(image_added) as document:
            self.assertGreaterEqual(len(document[0].get_images()), 1)

        form_pdf = self.output("form.pdf")
        main.create_form_field(
            main.CreateFormFieldRequest(
                file_path=str(image_added),
                output_path=str(form_pdf),
                name="data_incasso",
                label="Data incasso",
                rect=(72, 220, 220, 245),
            )
        )
        filled = self.output("form-filled.pdf")
        result = main.fill_forms(
            main.FillFormsRequest(
                file_path=str(form_pdf),
                output_path=str(filled),
                values={"data_incasso": "06/08/2026"},
            )
        )
        self.assertEqual(result["updated"], 1)
        with fitz.open(filled) as document:
            widgets = list(document[0].widgets() or [])
            self.assertEqual(len(widgets), 1)
            self.assertEqual(widgets[0].field_value, "06/08/2026")

    def test_pdf_info_and_validation_errors(self) -> None:
        info = main.pdf_info(main.PdfInfoRequest(file_path=str(self.source)))
        self.assertEqual(info["page_count"], 2)
        self.assertFalse(info["needs_password"])

        with self.assertRaises(HTTPException) as raised:
            main.add_text(
                main.AddTextRequest(
                    file_path=str(self.source),
                    output_path=str(self.output("outside.pdf")),
                    origin=(9999, 9999),
                    new_text="Fuori pagina",
                )
            )
        self.assertEqual(raised.exception.status_code, 400)


@unittest.skipUnless(
    os.environ.get("MAC_PDF_EDITOR_REGRESSION_PDF"),
    "Imposta MAC_PDF_EDITOR_REGRESSION_PDF per il test su un PDF reale",
)
class RealWorldPdfTests(BackendRegressionCase):
    def test_incomplete_embedded_font_falls_back_for_number_6(self) -> None:
        source = Path(os.environ["MAC_PDF_EDITOR_REGRESSION_PDF"]).expanduser().resolve()
        self.assertTrue(source.is_file())
        with fitz.open(source) as document:
            page = document[0]
            incomplete = next(
                font
                for font in page.get_fonts(full=True)
                if "franklin" in main.normalize_font_name(font[3])
                and main.font_resource_is_insertable(font)
                and not main.font_resource_supports_text(page, font, "6")
            )

        output = self.output("real-world-number-6.pdf")
        result = main.add_text(
            main.AddTextRequest(
                file_path=str(source),
                output_path=str(output),
                page_num=0,
                origin=(250, 500),
                new_text="06/08/2026",
                font="FranklinGothic-Book",
                font_resource=incomplete[4],
                size=10,
            )
        )
        self.assertEqual(result["font_used"], "Liberation Sans")
        self.assertIn("06/08/2026", page_text(output))


if __name__ == "__main__":
    unittest.main(verbosity=2)
