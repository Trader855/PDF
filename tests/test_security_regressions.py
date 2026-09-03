import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz
from fastapi import HTTPException
from backend import main


class SecurityRegressionTests(unittest.TestCase):
    def test_reject_non_pdf_symlink_and_oversized_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.pdf'
            with fitz.open() as document:
                document.new_page()
                document.save(source)
            alias = root / 'alias.pdf'
            alias.symlink_to(source)
            text = root / 'not-a-pdf.txt'
            text.write_text('not a PDF')
            for target in [alias, text]:
                with self.assertRaises(HTTPException):
                    main.open_pdf_path(str(target))
            with patch.object(main, 'MAX_PDF_BYTES', 1):
                with self.assertRaises(HTTPException) as raised:
                    main.open_pdf_path(str(source))
                self.assertEqual(raised.exception.status_code, 413)

    def test_production_output_stays_inside_private_session(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(main, 'SESSION_DIRECTORY', root):
                result = main.resolved_output_path(root / 'input.pdf', None)
                self.assertEqual(result.parent, root)
                with self.assertRaises(HTTPException):
                    main.resolved_output_path(root / 'input.pdf', '/tmp/output.pdf')
            with self.assertRaises(HTTPException):
                main.resolved_output_path(root / 'input.pdf', str(root / 'input.pdf'))

    def test_ocr_raster_size_is_bounded_before_allocation(self):
        class FakePage:
            rect = fitz.Rect(0, 0, 10000, 10000)
            def get_pixmap(self, matrix, alpha):
                self.pixels = self.rect.width * self.rect.height * matrix.a * matrix.d
                return 'bounded'
        page = FakePage()
        self.assertEqual(main.bounded_pixmap(page), 'bounded')
        self.assertLessEqual(page.pixels, main.MAX_RENDER_PIXELS)
        page.rect = fitz.Rect(0, 0, 10**9, 10**9)
        with self.assertRaises(HTTPException):
            main.bounded_pixmap(page)

    def test_document_wide_search_does_not_enable_ocr_by_default(self):
        request = main.FindRepeatedTextRequest(file_path='source.pdf', text='06')
        self.assertFalse(request.include_ocr)

    def test_compression_preserves_transparent_image_mask(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / 'alpha.pdf', root / 'compressed.pdf'
            pixmap = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 300, 300), True)
            pixmap.clear_with(100)
            with fitz.open() as document:
                page = document.new_page()
                page.insert_image(fitz.Rect(50, 50, 350, 350), pixmap=pixmap)
                document.save(source)
            main.compress_pdf(main.CompressRequest(file_path=str(source), output_path=str(output)))
            with fitz.open(source) as before, fitz.open(output) as after:
                self.assertTrue(before[0].get_images(full=True)[0][1])
                self.assertTrue(after[0].get_images(full=True)[0][1])


if __name__ == '__main__':
    unittest.main()
