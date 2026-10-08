"""Public, synthetic regressions; no customer documents or fonts included."""
from collections import Counter
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz
from fastapi import HTTPException

from backend import main, native_text


class NativeWordFidelityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='pdf-native-fidelity-')
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, cid=False, pages=1):
        source = self.root/'source.pdf'
        with fitz.open() as doc:
            for _ in range(pages):
                p = doc.new_page(width=420, height=220)
                if cid:
                    xref = p.insert_font(fontname='Original', fontbuffer=fitz.Font('hebo').buffer)
                else:
                    xref = p.insert_font(fontname='Original', fontfile=str(
                        main.bundled_fonts_directory()/'liberation/LiberationSans-Bold.ttf'))
                for y, text in [(80, 'RIGA SOPRA Milano'), (92, 'Torino Torino strada'), (104, 'RIGA SOTTO')]:
                    p.insert_text((40,y), text, fontname='Original', fontsize=12)
                if cid:
                    # Explicit bfchar CMap, as emitted by OCR-generated CFF PDFs.
                    observed = {gid: chr(cp) for t in p.get_texttrace() for cp, gid, _, _ in t['chars'] if gid >= 0}
                    ref = int(doc.xref_get_key(xref, 'ToUnicode')[1].split()[0])
                    pairs = ''.join(f'<{gid:04x}> <{value.encode("utf-16-be").hex()}>\n'
                                    for gid, value in observed.items())
                    doc.update_stream(ref, ('begincmap\n1 begincodespacerange\n<0000> <FFFF>\n'
                        f'endcodespacerange\n{len(observed)} beginbfchar\n{pairs}endbfchar\nendcmap').encode())
            doc.save(source)
        return source

    def selected(self, source, number=0):
        with fitz.open(source) as doc:
            return next(s for s in main.native_text_spans(doc[number]) if s['text']=='Torino Torino strada')

    def request(self, source, span, **changes):
        args = dict(file_path=str(source), output_path=str(self.root/'result.pdf'),
            bbox=span['bbox'], origin=span['origin'], font=span['font'],
            font_resource=span['font_resource'], size=span['size'], color=span['color'],
            original_text=span['text'], new_text='Torino Milano strada')
        args.update(changes)
        return main.EditTextRequest(**args)

    def test_original_redaction_algorithm_demonstrably_removes_neighboring_rows(self):
        source = self.fixture()
        span = self.selected(source)
        with fitz.open(source) as doc:
            p=doc[0]
            p.add_redact_annot(fitz.Rect(span['bbox']), fill=None, cross_out=False)
            p.apply_redactions(images=0, graphics=0, text=0)
            self.assertNotIn('RIGA SOPRA Milano', p.get_text())
            self.assertNotIn('RIGA SOTTO', p.get_text())

    def test_confirmed_font_change_keeps_both_neighboring_rows(self):
        source = self.fixture()
        span = self.selected(source)
        req = self.request(source, span, confirm_font_substitution=True,
                           confirmed_substitute_font='Liberation Sans Bold')
        result = main.edit_text(req)
        with fitz.open(result['output_path']) as doc:
            self.assertIn('RIGA SOPRA Milano', doc[0].get_text())
            self.assertIn('RIGA SOTTO', doc[0].get_text())
            self.assertIn('Torino Milano strada', doc[0].get_text())

    def test_cid_word_reuses_actual_embedded_font_and_untouched_glyphs(self):
        source = self.fixture(cid=True)
        span = self.selected(source)
        before_bytes = source.read_bytes()
        with fitz.open(source) as original:
            before = native_text.glyphs(original[0])
            plan = native_text.cid_word_edit(original[0], span['bbox'], span['font'],
                span['origin'], span['size'], span['color'], 'Torino Milano strada')
            self.assertIsNotNone(plan)
            remaining = before-plan.replaced
            full = original[0].get_pixmap()
            word = plan.bounds
        result = main.edit_text(self.request(source, span))
        self.assertEqual(result['edit_mode'], 'native_word')
        self.assertEqual(result['font_used'], span['font'])
        self.assertEqual(source.read_bytes(), before_bytes)
        with fitz.open(result['output_path']) as doc:
            self.assertFalse(remaining-native_text.glyphs(doc[0]))
            self.assertIn('Torino Milano strada', doc[0].get_text(sort=True))
            self.assertEqual(len(doc[0].search_for('Torino Milano strada')), 1)
            self.assertEqual(doc[0].get_text(sort=True).count('Torino'), 1)
            self.assertEqual(len(doc[0].get_fonts()), 1)
            after = doc[0].get_pixmap()
            changed_outside = 0
            for y in range(full.height):
                for x in range(full.width):
                    # A raster pixel covers an area, not only its top-left point.
                    if not word.intersects(fitz.Rect(x,y,x+1,y+1)) and full.pixel(x,y) != after.pixel(x,y):
                        changed_outside += 1
            self.assertEqual(changed_outside, 0)

    def test_missing_cid_has_no_silent_font_or_glyph_substitution(self):
        source = self.fixture(cid=True)
        before = source.read_bytes()
        with self.assertRaises(HTTPException) as caught:
            main.edit_text(self.request(source, self.selected(source), new_text='Torino ZZZZZZ strada'))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(source.read_bytes(), before)
        self.assertFalse((self.root/'result.pdf').exists())

    def test_second_word_edit_keeps_phrase_search_and_other_text(self):
        source = self.fixture(cid=True)
        first = main.edit_text(self.request(source, self.selected(source)))
        with fitz.open(first['output_path']) as doc:
            span = next(s for s in main.native_text_spans(doc[0]) if 'Milano' in s['text'] and 'SOPRA' not in s['text'])
        second = main.edit_text(self.request(first['output_path'], span,
            output_path=str(self.root/'second.pdf'), new_text=span['text'].replace('Milano','Torino')))
        self.assertEqual(second['edit_mode'], 'native_word')
        with fitz.open(second['output_path']) as doc:
            self.assertEqual(len(doc[0].search_for('Torino Torino strada')), 1)
            self.assertIn('RIGA SOPRA Milano', doc[0].get_text())
            self.assertIn('RIGA SOTTO', doc[0].get_text())

    def test_pixel_check_rejects_a_different_outline_outside_the_word(self):
        source = self.fixture(cid=True)
        span = self.selected(source)
        with fitz.open(source) as doc:
            plan = native_text.cid_word_edit(doc[0],span['bbox'],span['font'],span['origin'],
                span['size'],span['color'],'Torino Milano strada')
            self.assertIsNotNone(plan)
            self.assertTrue(plan.pixels_verified(doc[0]))
            doc[0].draw_rect(fitz.Rect(40,80,42,82), color=(0,0,0), fill=(0,0,0))
            self.assertFalse(plan.pixels_verified(doc[0]))

    def test_collateral_deletion_is_rejected_before_any_output(self):
        source = self.fixture()
        before = source.read_bytes()
        span = self.selected(source)
        apply = fitz.Page.apply_redactions
        def collateral(p, *args, **kwargs):
            p.add_redact_annot(fitz.Rect(span['bbox']), fill=None, cross_out=False)
            return apply(p, *args, **kwargs)
        with patch.object(fitz.Page, 'apply_redactions', collateral), self.assertRaises(HTTPException) as caught:
            main.edit_text(self.request(source, span, confirm_font_substitution=True,
                confirmed_substitute_font='Liberation Sans Bold'))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(source.read_bytes(), before)
        self.assertFalse((self.root/'result.pdf').exists())
        self.assertEqual(list(self.root.glob('.*.tmp.pdf')), [])

    def test_native_batch_keeps_neighboring_rows_on_each_page(self):
        source = self.fixture(pages=2)
        changes = []
        for number in range(2):
            span = self.selected(source, number)
            changes.append(main.BatchTextChange(page_num=number, bbox=span['bbox'], origin=span['origin'],
                font=span['font'], size=span['size'], confirm_font_substitution=True,
                confirmed_substitute_font='Liberation Sans Bold'))
        result = main.batch_edit_text(main.BatchEditTextRequest(file_path=str(source),
            output_path=str(self.root/'batch.pdf'), old_text='Torino Torino strada',
            new_text='Torino Milano strada', changes=changes))
        with fitz.open(result['output_path']) as doc:
            for p in doc:
                self.assertIn('RIGA SOPRA Milano', p.get_text())
                self.assertIn('RIGA SOTTO', p.get_text())

    def test_stale_selection_is_rejected_without_output(self):
        source = self.fixture()
        with self.assertRaises(HTTPException) as caught:
            main.edit_text(self.request(source, self.selected(source), original_text='Non il testo originale'))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertFalse((self.root/'result.pdf').exists())

    def test_width_parser_rejects_cycles_nesting_and_non_numeric_tokens(self):
        with fitz.open() as doc:
            xref=doc.get_new_xref()
            doc.update_object(xref, f'[{xref} 0 R]')
            for value in [f'[{xref} 0 R]', '['*10+'1'+']'*10, '[1 /Fake]', '[1] [2]']:
                with self.subTest(value=value), self.assertRaises(native_text.NativeEditError):
                    native_text._numeric_array(doc, value)


if __name__=='__main__':
    unittest.main()
