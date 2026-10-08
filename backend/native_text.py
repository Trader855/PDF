"""Conservative native-text edits: prove the target and keep unrelated glyphs.

The CID path reuses an existing horizontal CFF subset for a single word only.
It is not a font reconstructor or a generic PDF content-stream interpreter.
"""
from collections import Counter, defaultdict
from dataclasses import dataclass
import math
import re

import fitz


class NativeEditError(ValueError):
    pass


def _name(value):
    return re.sub(r"[^a-z0-9]", "", re.sub(r"^[A-Z]{6}\+", "", value).lower())


def _visible(span):
    return span.get('alpha', 255) > 0 and (
        'char_flags' not in span or span['char_flags'] & (16 | 32))


def _label(character, origin, font):
    return character, round(origin[0], 2), round(origin[1], 2), font


def glyphs(page):
    records = []
    for trace in page.get_texttrace():
        if trace['type'] == 3 or trace.get('opacity', 1) == 0:
            continue
        for char in trace['chars']:
            records.append((_label(chr(char[0]), char[2], trace['font']), char[1],
                round(trace['size'], 2), tuple(round(v, 4) for v in trace['dir']),
                tuple(round(v, 4) for v in trace['color']), trace['type'],
                round(trace.get('opacity', 1), 4), tuple(round(v, 2) for v in char[3])))
            if len(records) > 100_000:
                raise NativeEditError('Pagina troppo complessa per una modifica verificabile.')
    return Counter(records)


@dataclass
class NativeTarget:
    span: dict
    chars: list
    rect: fitz.Rect
    removed: Counter


def target(page, bbox, start=0, end=None, whole_line=False):
    lines = [l for b in page.get_text('rawdict')['blocks'] for l in b.get('lines', [])]
    raw = [s for l in lines for s in l.get('spans', []) if _visible(s)]
    candidates = [(s,l) for l in lines for s in l.get('spans', []) if _visible(s)
                  and max(abs(a-b) for a, b in zip(s['bbox'], bbox)) < .05]
    if len(candidates) != 1:
        raise NativeEditError('La selezione non identifica una sola riga. Seleziona nuovamente il testo.')
    span, line = candidates[0]
    if whole_line:
        siblings = line['spans']
        if any(not _visible(s) or s['font'] != span['font'] for s in siblings):
            raise NativeEditError('Riga con caratteri diversi: riuso CID non disponibile.')
        span = {**span, 'chars': [c for s in siblings for c in s['chars']],
                'bbox': line['bbox'], '_sizes': {
                    _label(c['c'], c['origin'], s['font']): s['size'] for s in siblings for c in s['chars']}}
    chars = span['chars'][start:end]
    if not chars:
        raise NativeEditError('Selezione del testo vuota.')
    rect = fitz.Rect(chars[0]['bbox'])
    for char in chars[1:]:
        rect |= fitz.Rect(char['bbox'])
    labels = {_label(c['c'], c['origin'], span['font']) for c in chars}
    # Only actual drawn glyphs count: extracted spaces may be synthetic.
    before = glyphs(page)
    drawn_labels = {key[0] for key in before}
    removed = Counter({key: count for key, count in before.items() if key[0] in labels})
    if not removed:
        raise NativeEditError('I glifi originali non sono verificabili.')
    # MuPDF removes any glyph touching a redaction, not only contained glyphs.
    # Find a thin strip shared by target glyphs and disjoint from all others.
    boxes = [fitz.Rect(c['bbox']) for c in chars if not fitz.Rect(c['bbox']).is_empty]
    left = rect.x0 + min(.2, boxes[0].width / 3)
    right = rect.x1 - min(.2, boxes[-1].width / 3)
    low, high = max(b.y0 for b in boxes), min(b.y1 for b in boxes)
    intervals = [(low+.01, high-.01)] if high-low > .04 else []
    for other in raw:
        for char in other['chars']:
            label = _label(char['c'], char['origin'], other['font'])
            if label in labels or label not in drawn_labels:
                continue
            box = fitz.Rect(char['bbox'])
            if box.is_empty or box.x1 <= left or box.x0 >= right:
                continue
            result = []
            for lo, hi in intervals:
                if box.y1 <= lo or box.y0 >= hi:
                    result.append((lo, hi))
                else:
                    if box.y0-.01 > lo: result.append((lo, min(hi, box.y0-.01)))
                    if box.y1+.01 < hi: result.append((max(lo, box.y1+.01), hi))
            intervals = result
    if not intervals:
        raise NativeEditError('Le righe si sovrappongono: modifica annullata per proteggere il testo vicino.')
    lo, hi = max(intervals, key=lambda interval: interval[1]-interval[0])
    mid, half = (lo+hi)/2, min(.1, (hi-lo)/3)
    if half < .005:
        raise NativeEditError('Non esiste un margine sicuro tra le righe.')
    strip = fitz.Rect(left, mid-half, right, mid+half)
    if any(fitz.Rect(link['from']).intersects(strip) for link in page.get_links()):
        raise NativeEditError('La selezione contiene un collegamento: modifica annullata per conservarlo.')
    if any(annot.type[0] == fitz.PDF_ANNOT_REDACT for annot in (page.annots() or [])):
        raise NativeEditError('La pagina contiene redazioni in sospeso. Nessuna modifica salvata.')
    return NativeTarget(span, chars, strip, removed)


def check_redaction(page, before, targets):
    removed = Counter()
    for item in targets:
        if removed & item.removed:
            raise NativeEditError('Le selezioni di testo si sovrappongono.')
        removed.update(item.removed)
    if glyphs(page) != before - removed:
        raise NativeEditError('La modifica toccherebbe altri caratteri. Nessuna modifica salvata.')


def _numeric_array(doc, value, depth=0):
    if depth > 4 or len(value) > 200_000:
        raise NativeEditError('Tabella delle larghezze del font non supportata.')
    tokens = re.findall(r'\[|\]|R|[+-]?(?:\d+\.\d*|\.\d+|\d+)', value)
    if re.sub(r'\[|\]|R|[+-]?(?:\d+\.\d*|\.\d+|\d+)|\s', '', value):
        raise NativeEditError('Tabella delle larghezze del font non supportata.')
    if len(tokens) > 20_000 or not tokens or tokens[0] != '[':
        raise NativeEditError('Tabella delle larghezze del font non supportata.')
    index = 0
    def read(nesting=0):
        nonlocal index
        if nesting > 8: raise NativeEditError('Tabella troppo annidata.')
        if index >= len(tokens): raise NativeEditError('Tabella incompleta.')
        token = tokens[index]; index += 1
        if token == '[':
            result = []
            while index < len(tokens) and tokens[index] != ']': result.append(read(nesting+1))
            if index >= len(tokens): raise NativeEditError('Tabella incompleta.')
            index += 1
            return result
        if token in {']', 'R'}: raise NativeEditError('Tabella non valida.')
        number = float(token)
        if index+1 < len(tokens) and tokens[index] == '0' and tokens[index+1] == 'R':
            index += 2
            if number != int(number) or number <= 0: raise NativeEditError('Riferimento font non valido.')
            return _numeric_array(doc, doc.xref_object(int(number)), depth+1)
        return number
    result = read()
    if index != len(tokens): raise NativeEditError('Tabella non valida.')
    return result


def _widths(doc, descendant):
    kind, value = doc.xref_get_key(descendant, 'W')
    if kind == 'xref':
        value = doc.xref_object(int(value.split()[0]))
        kind = 'array'
    if kind != 'array': raise NativeEditError('Larghezze CID non disponibili.')
    data = _numeric_array(doc, value)
    result, index = {}, 0
    while index < len(data):
        start = data[index]; index += 1
        if not isinstance(start, float) or start != int(start) or not 0 <= start <= 65535:
            raise NativeEditError('Indice CID non valido.')
        start = int(start)
        item = data[index]; index += 1
        if isinstance(item, list):
            values = item
        else:
            if item != int(item) or item < start or item-start > 4096:
                raise NativeEditError('Intervallo CID non valido.')
            width = data[index]; index += 1
            values = [width] * (int(item)-start+1)
        for offset, width in enumerate(values):
            if not isinstance(width, float) or not 0 <= width < 5000 or start+offset > 65535:
                raise NativeEditError('Larghezza CID non valida.')
            result[start+offset] = width
    return result


def _unicode_map(doc, xref):
    kind, reference = doc.xref_get_key(xref, 'ToUnicode')
    if kind != 'xref': raise NativeEditError('Mappa Unicode mancante.')
    data = doc.xref_stream(int(reference.split()[0]))
    if len(data) > 200_000: raise NativeEditError('Mappa Unicode troppo grande.')
    text = data.decode('ascii')
    # This path deliberately supports only explicit two-byte bfchar maps.
    if 'beginbfrange' in text or 'usecmap' in text:
        raise NativeEditError('Mappa Unicode non supportata.')
    result = {}
    for count, block in re.findall(r'(\d+)\s+beginbfchar(.*?)endbfchar', text, re.S):
        pairs = re.findall(r'<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]+)>', block)
        if len(pairs) != int(count): raise NativeEditError('Mappa Unicode incompleta.')
        for cid, encoded in pairs:
            value = bytes.fromhex(encoded).decode('utf-16-be')
            code = int(cid, 16)
            if code in result and result[code] != value:
                raise NativeEditError('Mappa Unicode ambigua.')
            result[code] = value
    if not result or len(result) > 4096: raise NativeEditError('Mappa Unicode non supportata.')
    return result


@dataclass
class CIDWordEdit:
    target: NativeTarget
    font: tuple
    stream: bytes
    word: str
    codes: tuple
    bounds: fitz.Rect
    replaced: Counter
    word_origin: tuple
    pixels: fitz.Pixmap
    clip: fitz.Rect

    def verified(self, page):
        for trace in page.get_texttrace():
            if (trace['font'] != self.target.span['font'] or trace['type'] != 0
                or trace.get('opacity', 1) != 1): continue
            if not fitz.Rect(trace['bbox']).intersects(self.bounds): continue
            chars = trace['chars']
            for index, char in enumerate(chars):
                if char[0] != ord(self.word[0]) or math.dist(char[2], self.word_origin) >= .01: continue
                run = chars[index:index+len(self.word)]
                if (''.join(chr(c[0]) for c in run) == self.word
                    and tuple(c[1] for c in run) == self.codes):
                    return self.pixels_verified(page)
        return False

    def pixels_verified(self, page):
        after = page.get_pixmap(matrix=fitz.Matrix(2,2), clip=self.clip, alpha=False, annots=False)
        before = self.pixels
        if (before.x,before.y,before.width,before.height,before.n) != (
            after.x,after.y,after.width,after.height,after.n): return False
        # Text metric boxes omit small bearings/antialias fringes of a glyph.
        mask = (self.bounds+(-1,-1,1,1))*fitz.Matrix(2,2)
        different = 0
        for y in range(before.height):
            for x in range(before.width):
                if mask.intersects(fitz.Rect(x+before.x,y+before.y,x+before.x+1,y+before.y+1)): continue
                delta = max(abs(a-b) for a,b in zip(before.pixel(x,y), after.pixel(x,y)))
                if delta:
                    different += 1
                    # Permit only tiny float-rounding differences at a few edges;
                    # never accept removed strokes or differently shaped glyphs.
                    if delta > 2 or different > 20: return False
        return True

    def insert(self, page):
        doc = page.parent
        # Redaction may prune the resource: reattach the exact original xref.
        resource = doc.xref_get_key(page.xref, 'Resources')[1]
        owner = int(resource.split()[0]) if resource.endswith(' 0 R') else page.xref
        key = 'Font/'+self.font[4] if owner != page.xref else 'Resources/Font/'+self.font[4]
        doc.xref_set_key(owner, key, f'{self.font[0]} 0 R')
        xref = doc.get_new_xref()
        doc.update_object(xref, '<<>>')
        doc.update_stream(xref, self.stream)
        doc.xref_set_key(page.xref, 'Contents', '[ '+' '.join(
            f'{x} 0 R' for x in page.get_contents()+[xref])+' ]')


def cid_word_edit(page, bbox, font_name, origin, size, color, new_text):
    """Return None outside the explicitly supported, unchanged-style word case."""
    if page.rotation or len(new_text) > 2000: return None
    selected = target(page, bbox)
    span = selected.span
    old = ''.join(c['c'] for c in span['chars'])
    if (_name(font_name) != _name(span['font']) or abs(size-span['size']) > .01
        or color != span['color'] or math.dist(origin, span['origin']) > .01
        or old == new_text): return None
    start = 0
    while start < min(len(old), len(new_text)) and old[start] == new_text[start]: start += 1
    finish, new_finish = len(old), len(new_text)
    while finish > start and new_finish > start and old[finish-1] == new_text[new_finish-1]:
        finish -= 1; new_finish -= 1
    while start > 0 and not old[start-1].isspace(): start -= 1
    while finish < len(old) and not old[finish].isspace(): finish += 1
    suffix = old[finish:]
    end = len(new_text)-len(suffix)
    word = new_text[start:end]
    if (new_text[:start] != old[:start] or new_text[end:] != suffix or not word
        or len(word) > 32 or any(c.isspace() for c in word) or any(c.isspace() for c in old[start:finish])):
        return None
    doc = page.parent
    if doc.get_ocgs(): return None
    if doc.xref_get_key(page.xref, 'Resources')[0] not in {'dict', 'xref'}:
        return None
    fonts = []
    for font in page.get_fonts(full=True):
        if font[2] != 'Type0' or font[5] != 'Identity-H' or font[6] != 0: continue
        children = re.findall(r'(\d+) 0 R', doc.xref_get_key(font[0], 'DescendantFonts')[1])
        if len(children) != 1: continue
        child = int(children[0])
        if doc.xref_get_key(child, 'Subtype')[1] != '/CIDFontType0': continue
        if _name(doc.xref_get_key(child, 'BaseFont')[1].lstrip('/')) == _name(span['font']):
            fonts.append((font, child))
    if len(fonts) != 1: return None
    font, child = fonts[0]
    if not re.fullmatch(r'[A-Za-z0-9_]+', font[4]): return None
    if not doc.extract_font(font[0])[3]: return None
    try:
        mapping, widths = _unicode_map(doc, font[0]), _widths(doc, child)
        observed = defaultdict(list)
        for trace in page.get_texttrace():
            if trace['font'] != span['font'] or trace['type'] != 0 or trace.get('opacity', 1) != 1: continue
            for cp, gid, position, _ in trace['chars']:
                if gid > 0 and mapping.get(gid) == chr(cp) and gid in widths:
                    observed[chr(cp)].append((gid, position))
        selection = target(page, bbox, start, finish)
        whole = target(page, bbox, whole_line=True)
        first = selection.chars[0]['origin']
        codes = [min(observed[c], key=lambda item: math.dist(item[1], first))[0] for c in word]
        rect = fitz.Rect(selection.chars[0]['bbox'])
        for char in selection.chars[1:]: rect |= fitz.Rect(char['bbox'])
        source_trace = next(t for t in page.get_texttrace() if t['font'] == span['font']
            and any(math.dist(c[2], first) < .01 for c in t['chars']))
        direction = source_trace['dir']
        if (direction[0] < .999 or abs(direction[1]) > .02
            or len(source_trace['color']) != 3): return None
        # Preserve vertical size when an earlier word has a narrower text matrix.
        vertical_size = size*size/(source_trace['size']*direction[0])
        width = sum(widths[c] for c in codes)*vertical_size/1000
        scale = min(1, rect.width/width)
        if not .85 <= scale <= 1 or any(widths[c] <= 0 for c in codes): return None
        # Only opaque, nearly horizontal text is admitted; the saved glyphs
        # are checked again instead of assuming CID and glyph IDs coincide.
        point = fitz.Point(first) * ~page.transformation_matrix
        rgb = fitz.sRGB_to_pdf(color)
        matrix = (scale, -direction[1]/direction[0]*scale, 0, 1, point.x, point.y)
        word_stream = ('q BT /'+font[4]+f' {vertical_size:.8f} Tf '+
                  ' '.join(f'{c:.8f}' for c in rgb)+' rg '+
                  ' '.join(f'{v:.8f}' for v in matrix)+' Tm <'+
                  ''.join(f'{c:04x}' for c in codes)+'> Tj ET Q\n').encode('ascii')
        labels = {key[0] for key in whole.removed}
        replaced = {key[0] for key in selection.removed}
        program, inserted = [], False
        for trace in page.get_texttrace():
            chars = trace['chars']
            index = 0
            while index < len(chars):
                char = chars[index]
                label = _label(chr(char[0]), char[2], trace['font'])
                index += 1
                if label not in labels: continue
                if char[1] < 0: return None
                group = [char]
                while index < len(chars) and chars[index][1] < 0:
                    group.append(chars[index]); index += 1
                group_labels = {_label(chr(c[0]), c[2], trace['font']) for c in group}
                if (not group_labels <= labels or mapping.get(char[1]) != ''.join(chr(c[0]) for c in group)
                    or trace['type'] != 0 or trace.get('opacity', 1) != 1
                    or len(trace['color']) != 3): return None
                if group_labels & replaced:
                    if not group_labels <= replaced: return None
                    if not inserted: program.append(word_stream); inserted = True
                    continue
                nominal = whole.span['_sizes'][label]
                h = trace['size']*trace['dir'][0]/nominal
                b = -trace['size']*trace['dir'][1]/nominal
                if not .7 < h < 1.4 or abs(b) > .02: return None
                point = fitz.Point(char[2])*~page.transformation_matrix
                program.append((f'q BT /{font[4]} {nominal:.8f} Tf '+
                    ' '.join(f'{c:.8f}' for c in trace['color'])+' rg '+
                    f'{h:.8f} {b:.8f} 0 {1/h:.8f} {point.x:.8f} {point.y:.8f} Tm '
                    f'<{char[1]:04x}> Tj ET Q\n').encode('ascii'))
        if not inserted: return None
        clip = (fitz.Rect(whole.span['bbox'])+(-2,-2,2,2)) & page.rect
        if clip.is_empty or clip.width*clip.height*4 > 500_000: return None
        pixels = page.get_pixmap(matrix=fitz.Matrix(2,2),clip=clip,alpha=False,annots=False)
        return CIDWordEdit(whole, font, b''.join(program), word, tuple(codes), rect,
                           selection.removed, first, pixels, clip)
    except (NativeEditError, ValueError, IndexError, KeyError, StopIteration, ZeroDivisionError):
        return None
