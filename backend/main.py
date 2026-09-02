import base64
import binascii
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import fitz
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field


app = FastAPI(title="Mac PDF Editor Backend")
OCR_INSPECTION_CACHE: Dict[Tuple[str, int, int, int], List[Dict[str, Any]]] = {}

BUNDLED_FONT_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "liberation-sans",
        "family": "Liberation Sans",
        "aliases": (
            "Arial", "Arial MT", "Helvetica", "Helvetica Neue", "Aptos",
            "Franklin Gothic", "Franklin Gothic Book", "Univers", "Verdana",
        ),
        "files": {
            "regular": "liberation/LiberationSans-Regular.ttf",
            "bold": "liberation/LiberationSans-Bold.ttf",
            "italic": "liberation/LiberationSans-Italic.ttf",
            "bold_italic": "liberation/LiberationSans-BoldItalic.ttf",
        },
    },
    {
        "id": "liberation-serif",
        "family": "Liberation Serif",
        "aliases": ("Times", "Times New Roman", "Times Roman", "Georgia"),
        "files": {
            "regular": "liberation/LiberationSerif-Regular.ttf",
            "bold": "liberation/LiberationSerif-Bold.ttf",
            "italic": "liberation/LiberationSerif-Italic.ttf",
            "bold_italic": "liberation/LiberationSerif-BoldItalic.ttf",
        },
    },
    {
        "id": "liberation-mono",
        "family": "Liberation Mono",
        "aliases": ("Courier", "Courier New", "Menlo", "Monaco"),
        "files": {
            "regular": "liberation/LiberationMono-Regular.ttf",
            "bold": "liberation/LiberationMono-Bold.ttf",
            "italic": "liberation/LiberationMono-Italic.ttf",
            "bold_italic": "liberation/LiberationMono-BoldItalic.ttf",
        },
    },
    {
        "id": "carlito",
        "family": "Carlito",
        "aliases": ("Calibri",),
        "files": {
            "regular": "carlito/Carlito-Regular.ttf",
            "bold": "carlito/Carlito-Bold.ttf",
            "italic": "carlito/Carlito-Italic.ttf",
            "bold_italic": "carlito/Carlito-BoldItalic.ttf",
        },
    },
    {
        "id": "caladea",
        "family": "Caladea",
        "aliases": ("Cambria",),
        "files": {
            "regular": "caladea/Caladea-Regular.ttf",
            "bold": "caladea/Caladea-Bold.ttf",
            "italic": "caladea/Caladea-Italic.ttf",
            "bold_italic": "caladea/Caladea-BoldItalic.ttf",
        },
    },
]

FONT_STYLE_LABELS = {
    "regular": "",
    "bold": " Bold",
    "italic": " Italic",
    "bold_italic": " Bold Italic",
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InspectRequest(BaseModel):
    file_path: str
    page_num: int = 0


class SearchTextRequest(BaseModel):
    file_path: str
    query: str = Field(min_length=1, max_length=200)
    max_results: int = Field(default=2000, ge=1, le=5000)


class EditTextRequest(BaseModel):
    file_path: str
    output_path: Optional[str] = None
    page_num: int = 0
    bbox: Tuple[float, float, float, float]
    origin: Tuple[float, float]
    new_text: str
    font: str = "Helvetica"
    font_resource: Optional[str] = None
    size: float = Field(default=11, gt=0, le=500)
    color: int = 0
    source: str = "native"
    background_color: int = 0xFFFFFF


class FindRepeatedTextRequest(BaseModel):
    file_path: str
    text: str = Field(min_length=1, max_length=2000)
    include_ocr: bool = True


class BatchTextChange(BaseModel):
    page_num: int = Field(ge=0)
    bbox: Tuple[float, float, float, float]
    origin: Tuple[float, float]
    font: str = "Helvetica"
    font_resource: Optional[str] = None
    size: float = Field(default=11, gt=0, le=500)
    color: int = 0
    source: str = "native"
    background_color: int = 0xFFFFFF


class BatchEditTextRequest(BaseModel):
    file_path: str
    output_path: Optional[str] = None
    old_text: str = Field(min_length=1, max_length=2000)
    new_text: str = Field(max_length=2000)
    changes: List[BatchTextChange] = Field(min_length=1, max_length=500)


class AddTextRequest(BaseModel):
    file_path: str
    output_path: Optional[str] = None
    page_num: int = 0
    origin: Tuple[float, float]
    new_text: str
    font: str = "Helvetica"
    font_resource: Optional[str] = None
    size: float = Field(default=11, gt=0, le=500)
    color: int = 0


class PdfInfoRequest(BaseModel):
    file_path: str


class UnlockPdfRequest(BaseModel):
    file_path: str
    password: str
    output_path: Optional[str] = None


class ReorderPagesRequest(BaseModel):
    file_path: str
    order: List[int]
    output_path: Optional[str] = None


class InsertPdfRequest(BaseModel):
    file_path: str
    insert_file_path: str
    insert_at: int
    insert_password: Optional[str] = None
    output_path: Optional[str] = None


class AddImageRequest(BaseModel):
    file_path: str
    page_num: int = 0
    rect: Tuple[float, float, float, float]
    image_data: str
    output_path: Optional[str] = None


class PageOperationRequest(BaseModel):
    file_path: str
    page_num: int = 0
    action: str
    output_path: Optional[str] = None


class AnnotationRequest(BaseModel):
    file_path: str
    page_num: int = 0
    kind: str
    rect: Optional[Tuple[float, float, float, float]] = None
    points: List[Tuple[float, float]] = Field(default_factory=list)
    color: Tuple[float, float, float] = (1.0, 0.8, 0.0)
    opacity: float = Field(default=0.45, ge=0.05, le=1.0)
    width: float = Field(default=2.0, ge=0.5, le=30)
    output_path: Optional[str] = None


class FillFormsRequest(BaseModel):
    file_path: str
    values: Dict[str, Any]
    output_path: Optional[str] = None


class CreateFormFieldRequest(BaseModel):
    file_path: str
    page_num: int = 0
    field_type: str = "text"
    name: str
    label: Optional[str] = None
    rect: Tuple[float, float, float, float]
    choices: List[str] = Field(default_factory=list)
    output_path: Optional[str] = None


class CompressRequest(BaseModel):
    file_path: str
    quality: str = "balanced"
    output_path: Optional[str] = None


class OcrRequest(BaseModel):
    file_path: str
    page_nums: Optional[List[int]] = None
    force: bool = False
    output_path: Optional[str] = None


def normalize_font_name(name: str) -> str:
    """Normalizza nomi come ABCDEF+Helvetica-Bold per confrontare le risorse."""
    without_subset = re.sub(r"^[A-Z]{6}\+", "", name or "")
    return re.sub(r"[^a-z0-9]", "", without_subset.lower())


def bundled_fonts_directory() -> Path:
    configured = os.environ.get("MAC_PDF_EDITOR_FONTS_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parent.parent / "assets" / "fonts"


def normalized_font_family(name: str) -> str:
    normalized = normalize_font_name(name)
    for token in (
        "bolditalic", "boldoblique", "semibolditalic", "semibold",
        "demibold", "extrabold", "ultrabold", "bold", "italic",
        "oblique", "regular", "roman", "book", "medium", "light",
        "thin", "mt", "ps",
    ):
        normalized = normalized.replace(token, "")
    return normalized


def requested_font_style(name: str) -> str:
    normalized = normalize_font_name(name)
    is_bold = any(token in normalized for token in ("bold", "semibold", "demibold", "demi"))
    is_italic = any(token in normalized for token in ("italic", "oblique"))
    if is_bold and is_italic:
        return "bold_italic"
    if is_bold:
        return "bold"
    if is_italic:
        return "italic"
    return "regular"


def bundled_font_match(name: str, default_family: Optional[str] = None) -> Optional[Dict[str, Any]]:
    wanted = normalized_font_family(name)
    best: Optional[Tuple[int, Dict[str, Any]]] = None

    for family in BUNDLED_FONT_CATALOG:
        candidates = (family["family"], *family["aliases"])
        for candidate in candidates:
            normalized_candidate = normalized_font_family(candidate)
            score = 0
            if wanted and wanted == normalized_candidate:
                score = 100
            elif wanted and len(wanted) >= 4 and (
                wanted in normalized_candidate or normalized_candidate in wanted
            ):
                score = 60
            if score and (best is None or score > best[0]):
                best = (score, family)

    if best is None and default_family:
        best = next(
            (
                (1, family)
                for family in BUNDLED_FONT_CATALOG
                if family["family"] == default_family
            ),
            None,
        )
    if best is None:
        return None

    family = best[1]
    style = requested_font_style(name)
    relative_file = family["files"].get(style) or family["files"]["regular"]
    font_path = bundled_fonts_directory() / relative_file
    if not font_path.is_file():
        return None
    return {
        "id": f"{family['id']}-{style.replace('_', '-')}",
        "family": family["family"],
        "style": style,
        "label": f"{family['family']}{FONT_STYLE_LABELS[style]}",
        "path": font_path,
    }


def register_bundled_font(
    page: fitz.Page,
    requested_name: str,
    default_family: Optional[str] = None,
    text: str = "",
) -> Optional[Tuple[str, str]]:
    selected = bundled_font_match(requested_name, default_family=default_family)
    if not selected:
        return None
    if text and not font_file_supports_text(selected["path"], text):
        return None
    resource_name = "MPF" + re.sub(r"[^A-Za-z0-9]", "", selected["id"])
    page.insert_font(fontname=resource_name, fontfile=str(selected["path"]))
    return resource_name, selected["label"]


def font_resource_is_insertable(font: Tuple[Any, ...]) -> bool:
    """Evita CMap CID/Identity-H che mostrano quadratini per i nuovi caratteri."""
    font_type = str(font[2] or "").casefold()
    encoding = str(font[5] or "").casefold()
    return font_type != "type0" and "identity" not in encoding


BASE14_FONT_NAMES = {
    "helvetica": "helv",
    "helveticabold": "hebo",
    "helveticaoblique": "heit",
    "helveticaboldoblique": "hebi",
    "timesroman": "tiro",
    "timesbold": "tibo",
    "timesitalic": "tiit",
    "timesbolditalic": "tibi",
    "courier": "cour",
    "courierbold": "cobo",
    "courieroblique": "coit",
    "courierboldoblique": "cobi",
}


def font_object_supports_text(font: fitz.Font, text: str) -> bool:
    """Rifiuta un font se anche un solo carattere visibile non ha un glifo."""
    return all(
        character.isspace() or font.has_glyph(ord(character)) != 0
        for character in text
    )


def font_file_supports_text(font_path: Path, text: str) -> bool:
    if not text:
        return True
    try:
        return font_object_supports_text(
            fitz.Font(fontbuffer=font_path.read_bytes()),
            text,
        )
    except Exception:
        return False


def base14_font_supports_text(font_name: str, text: str) -> bool:
    if not text:
        return True
    try:
        return font_object_supports_text(fitz.Font(fontname=font_name), text)
    except Exception:
        return False


def font_resource_supports_text(
    page: fitz.Page,
    font: Tuple[Any, ...],
    text: str,
) -> bool:
    """Controlla i glifi reali nel subset incorporato prima di riutilizzarlo."""
    if not font_resource_is_insertable(font):
        return False
    if not text:
        return True

    try:
        xref = int(font[0])
        if xref <= 0:
            return False
        extracted = page.parent.extract_font(xref)
        font_buffer = extracted[3]
        if font_buffer:
            checked_font = fitz.Font(fontbuffer=font_buffer)
        else:
            base14_name = BASE14_FONT_NAMES.get(normalize_font_name(font[3]))
            if not base14_name:
                return False
            checked_font = fitz.Font(fontname=base14_name)
        return font_object_supports_text(checked_font, text)
    except Exception:
        # Se la copertura non è dimostrabile, usa un font integrato completo.
        return False


def font_resource_for_span(
    page: fitz.Page,
    span_font: str,
    text: str = "",
) -> Optional[str]:
    wanted = normalize_font_name(span_font)
    candidates: List[Tuple[int, str]] = []

    for font in page.get_fonts(full=True):
        # xref, ext, type, basefont, resource-name, encoding, referencer
        base_font = normalize_font_name(font[3])
        resource_name = font[4]
        exact_match = bool(wanted and base_font == wanted)
        partial_match = bool(wanted and (wanted in base_font or base_font in wanted))
        if not (exact_match or partial_match) or not font_resource_supports_text(page, font, text):
            continue

        encoding = str(font[5] or "").casefold()
        font_type = str(font[2] or "").casefold()
        score = 100 if exact_match else 50
        if "winansi" in encoding:
            score += 30
        if font_type in {"truetype", "type1"}:
            score += 20
        candidates.append((score, resource_name))

    return max(candidates, default=(0, None))[1]


def requested_font_resource(
    page: fitz.Page,
    resource_name: Optional[str],
    text: str = "",
) -> Optional[str]:
    if not resource_name:
        return None
    return next(
        (
            font[4]
            for font in page.get_fonts(full=True)
            if font[4] == resource_name and font_resource_supports_text(page, font, text)
        ),
        None,
    )


def resolve_text_font(
    page: fitz.Page,
    requested_name: str,
    requested_resource: Optional[str],
    text: str,
    allow_original_resource: bool = True,
) -> Tuple[str, str]:
    """Sceglie un font solo dopo aver verificato tutti i glifi richiesti."""
    if allow_original_resource:
        resource = requested_font_resource(page, requested_resource, text)
        if not resource:
            resource = font_resource_for_span(page, requested_name, text)
        if resource:
            return resource, requested_name

    bundled = register_bundled_font(
        page,
        requested_name,
        default_family="Liberation Sans",
        text=text,
    )
    if bundled:
        return bundled

    if base14_font_supports_text("helv", text):
        return "helv", "Helvetica"

    raise HTTPException(
        status_code=422,
        detail=(
            "Nessun font disponibile contiene tutti i caratteri inseriti. "
            "Il testo originale non è stato modificato."
        ),
    )


def validate_document(file_path: str, page_num: int) -> Tuple[Path, fitz.Document]:
    path = Path(file_path).expanduser().resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File PDF non trovato")

    try:
        document = fitz.open(path)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"PDF non leggibile: {error}") from error

    if document.needs_pass:
        document.close()
        raise HTTPException(status_code=423, detail="Il PDF è protetto da password")

    if page_num < 0 or page_num >= document.page_count:
        document.close()
        raise HTTPException(status_code=400, detail="Numero pagina non valido")

    return path, document


def temporary_output_path(source: Path) -> Path:
    safe_stem = re.sub(r"[^a-zA-Z0-9._-]+", "-", source.stem).strip("-") or "documento"
    return Path(tempfile.gettempdir()) / f"{safe_stem}-modificato-{uuid.uuid4().hex[:8]}.pdf"


def resolved_output_path(source: Path, requested: Optional[str]) -> Path:
    output_path = Path(requested).expanduser().resolve() if requested else temporary_output_path(source)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    return output_path


def atomic_save(document: fitz.Document, output_path: Path, **options) -> None:
    save_path = output_path.with_name(f".{output_path.stem}-{uuid.uuid4().hex}.tmp.pdf")
    try:
        document.save(save_path, garbage=4, deflate=True, **options)
        document.close()
        os.replace(save_path, output_path)
    finally:
        if not document.is_closed:
            document.close()
        save_path.unlink(missing_ok=True)


def open_pdf_path(file_path: str, not_found_message: str = "File PDF non trovato") -> Tuple[Path, fitz.Document]:
    path = Path(file_path).expanduser().resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail=not_found_message)
    try:
        return path, fitz.open(path)
    except Exception as error:
        raise HTTPException(status_code=400, detail=f"PDF non leggibile: {error}") from error


def decode_image_data(image_data: str) -> bytes:
    encoded = image_data.split(",", 1)[1] if image_data.startswith("data:") and "," in image_data else image_data
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise HTTPException(status_code=400, detail="Dati immagine non validi") from error
    if not raw:
        raise HTTPException(status_code=400, detail="L'immagine è vuota")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="L'immagine supera il limite di 25 MB")
    return raw


@app.get("/health")
def health():
    return {"status": "ok", "pymupdf": fitz.VersionBind}


@app.get("/fonts")
def list_bundled_fonts():
    fonts: List[Dict[str, Any]] = []
    for family in BUNDLED_FONT_CATALOG:
        for style in ("regular", "bold", "italic", "bold_italic"):
            selected = bundled_font_match(
                f"{family['family']}{FONT_STYLE_LABELS[style]}"
            )
            if not selected:
                continue
            fonts.append(
                {
                    "id": selected["id"],
                    "family": selected["family"],
                    "style": selected["style"],
                    "label": selected["label"],
                    "aliases": list(family["aliases"]),
                }
            )
    return {"fonts": fonts}


@app.get("/font-file/{font_id}")
def bundled_font_file(font_id: str):
    selected = next(
        (
            bundled_font_match(f"{family['family']}{FONT_STYLE_LABELS[style]}")
            for family in BUNDLED_FONT_CATALOG
            for style in ("regular", "bold", "italic", "bold_italic")
            if f"{family['id']}-{style.replace('_', '-')}" == font_id
        ),
        None,
    )
    if not selected:
        raise HTTPException(status_code=404, detail="Font non disponibile")
    return FileResponse(selected["path"], media_type="font/ttf", filename=selected["path"].name)


@app.post("/page-operation")
def page_operation(req: PageOperationRequest):
    source_path, document = validate_document(req.file_path, req.page_num)
    output_path = resolved_output_path(source_path, req.output_path)
    try:
        if req.action == "rotate":
            page = document[req.page_num]
            page.set_rotation((page.rotation + 90) % 360)
            next_page = req.page_num
        elif req.action == "delete":
            if document.page_count <= 1:
                raise HTTPException(status_code=400, detail="Non puoi eliminare l'unica pagina del documento")
            document.delete_page(req.page_num)
            next_page = min(req.page_num, document.page_count - 1)
        elif req.action == "duplicate":
            copied = fitz.open()
            copied.insert_pdf(document, from_page=req.page_num, to_page=req.page_num)
            document.insert_pdf(copied, start_at=req.page_num + 1)
            copied.close()
            next_page = req.page_num + 1
        elif req.action == "extract":
            extracted = fitz.open()
            extracted.insert_pdf(document, from_page=req.page_num, to_page=req.page_num)
            document.close()
            atomic_save(extracted, output_path)
            return {"status": "ok", "output_path": str(output_path), "page_count": 1, "page_num": 0}
        else:
            raise HTTPException(status_code=400, detail="Operazione pagina non riconosciuta")

        page_count = document.page_count
        atomic_save(document, output_path)
        return {"status": "ok", "output_path": str(output_path), "page_count": page_count, "page_num": next_page}
    except HTTPException:
        if not document.is_closed:
            document.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"Operazione pagina non riuscita: {error}") from error


@app.post("/add-annotation")
def add_annotation(req: AnnotationRequest):
    source_path, document = validate_document(req.file_path, req.page_num)
    output_path = resolved_output_path(source_path, req.output_path)
    try:
        page = document[req.page_num]
        color = tuple(max(0.0, min(1.0, component)) for component in req.color)
        if req.kind in {"highlight", "rectangle"}:
            if not req.rect:
                raise HTTPException(status_code=400, detail="Disegna prima un'area sulla pagina")
            rect = fitz.Rect(req.rect)
            if rect.is_empty or not page.rect.contains(rect):
                raise HTTPException(status_code=400, detail="Area dell'annotazione non valida")
            if req.kind == "highlight":
                annotation = page.add_highlight_annot(rect)
                annotation.set_colors(stroke=color)
            else:
                annotation = page.add_rect_annot(rect)
                annotation.set_colors(stroke=color)
                annotation.set_border(width=req.width)
        elif req.kind == "arrow":
            if len(req.points) < 2:
                raise HTTPException(status_code=400, detail="Traccia prima la freccia sulla pagina")
            start, end = fitz.Point(req.points[0]), fitz.Point(req.points[-1])
            if not page.rect.contains(start) or not page.rect.contains(end):
                raise HTTPException(status_code=400, detail="Coordinate della freccia non valide")
            annotation = page.add_line_annot(start, end)
            annotation.set_line_ends(fitz.PDF_ANNOT_LE_NONE, fitz.PDF_ANNOT_LE_CLOSED_ARROW)
            annotation.set_colors(stroke=color)
            annotation.set_border(width=req.width)
        elif req.kind == "ink":
            if len(req.points) < 2:
                raise HTTPException(status_code=400, detail="Disegna prima un tratto sulla pagina")
            points = [[float(point[0]), float(point[1])] for point in req.points]
            if any(not page.rect.contains(fitz.Point(point)) for point in points):
                raise HTTPException(status_code=400, detail="Coordinate del disegno non valide")
            annotation = page.add_ink_annot([points])
            annotation.set_colors(stroke=color)
            annotation.set_border(width=req.width)
        else:
            raise HTTPException(status_code=400, detail="Tipo di annotazione non riconosciuto")

        annotation.set_opacity(req.opacity)
        annotation.update()
        atomic_save(document, output_path)
        return {"status": "ok", "output_path": str(output_path)}
    except HTTPException:
        if not document.is_closed:
            document.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"Annotazione non riuscita: {error}") from error


@app.post("/inspect-forms")
def inspect_forms(req: InspectRequest):
    _, document = validate_document(req.file_path, req.page_num)
    try:
        fields = []
        for widget in document[req.page_num].widgets() or []:
            fields.append({
                "name": widget.field_name or f"field-{widget.xref}",
                "label": widget.field_label or widget.field_name or "Campo",
                "type": widget.field_type_string or "Unknown",
                "type_id": widget.field_type,
                "value": widget.field_value,
                "choices": list(widget.choice_values or []),
                "on_state": widget.on_state() if widget.field_type in {fitz.PDF_WIDGET_TYPE_CHECKBOX, fitz.PDF_WIDGET_TYPE_RADIOBUTTON} else None,
                "rect": list(widget.rect),
                "xref": widget.xref,
            })
        return {"page_num": req.page_num, "fields": fields}
    finally:
        document.close()


@app.post("/create-form-field")
def create_form_field(req: CreateFormFieldRequest):
    source_path, document = validate_document(req.file_path, req.page_num)
    output_path = resolved_output_path(source_path, req.output_path)
    field_name = req.name.strip()
    if not field_name:
        document.close()
        raise HTTPException(status_code=400, detail="Inserisci un nome per il nuovo campo")

    allowed_types = {
        "text": fitz.PDF_WIDGET_TYPE_TEXT,
        "multiline": fitz.PDF_WIDGET_TYPE_TEXT,
        "checkbox": fitz.PDF_WIDGET_TYPE_CHECKBOX,
        "combobox": fitz.PDF_WIDGET_TYPE_COMBOBOX,
    }
    if req.field_type not in allowed_types:
        document.close()
        raise HTTPException(status_code=400, detail="Tipo di campo modulo non riconosciuto")

    try:
        for page in document:
            if any(widget.field_name == field_name for widget in page.widgets() or []):
                raise HTTPException(status_code=409, detail=f"Esiste già un campo chiamato '{field_name}'")

        page = document[req.page_num]
        rect = fitz.Rect(req.rect)
        if rect.is_empty or rect.is_infinite or not page.rect.contains(rect) or rect.width < 8 or rect.height < 8:
            raise HTTPException(status_code=400, detail="Disegna un'area valida per il nuovo campo")
        choices = [str(choice).strip() for choice in req.choices if str(choice).strip()]
        if req.field_type == "combobox" and not choices:
            raise HTTPException(status_code=400, detail="Inserisci almeno un'opzione per il menu a scelta")

        widget = fitz.Widget()
        widget.field_name = field_name
        widget.field_label = (req.label or field_name).strip() or field_name
        widget.field_type = allowed_types[req.field_type]
        widget.rect = rect
        widget.border_color = (0.23, 0.44, 0.96)
        widget.border_width = 1
        widget.fill_color = (1, 1, 1)
        widget.text_color = (0.08, 0.1, 0.14)
        widget.text_font = "Helv"
        widget.text_fontsize = max(8, min(14, rect.height * 0.58))
        if req.field_type == "multiline":
            widget.field_flags = fitz.PDF_TX_FIELD_IS_MULTILINE
            widget.field_value = ""
        elif req.field_type == "checkbox":
            widget.field_value = "Off"
        elif req.field_type == "combobox":
            widget.choice_values = choices
            widget.field_value = choices[0]
        else:
            widget.field_value = ""
        page.add_widget(widget)
        atomic_save(document, output_path)
        return {
            "status": "ok",
            "output_path": str(output_path),
            "name": field_name,
            "field_type": req.field_type,
        }
    except HTTPException:
        if not document.is_closed:
            document.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"Creazione campo non riuscita: {error}") from error


@app.post("/fill-forms")
def fill_forms(req: FillFormsRequest):
    source_path, document = open_pdf_path(req.file_path)
    if document.needs_pass:
        document.close()
        raise HTTPException(status_code=423, detail="Sblocca il PDF prima di compilare i moduli")
    output_path = resolved_output_path(source_path, req.output_path)
    updated = 0
    try:
        for page in document:
            for widget in page.widgets() or []:
                if widget.field_name not in req.values:
                    continue
                value = req.values[widget.field_name]
                if widget.field_type == fitz.PDF_WIDGET_TYPE_RADIOBUTTON:
                    on_state = widget.on_state() or "Yes"
                    widget.field_value = on_state if str(value) == on_state else "Off"
                elif widget.field_type == fitz.PDF_WIDGET_TYPE_CHECKBOX:
                    widget.field_value = (widget.on_state() or "Yes") if bool(value) else "Off"
                else:
                    widget.field_value = "" if value is None else str(value)
                widget.update()
                updated += 1
        if not updated:
            raise HTTPException(status_code=400, detail="Nessun campo del modulo è stato aggiornato")
        atomic_save(document, output_path)
        return {"status": "ok", "output_path": str(output_path), "updated": updated}
    except HTTPException:
        if not document.is_closed:
            document.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"Compilazione modulo non riuscita: {error}") from error


@app.post("/compress-pdf")
def compress_pdf(req: CompressRequest):
    source_path, document = open_pdf_path(req.file_path)
    if document.needs_pass:
        document.close()
        raise HTTPException(status_code=423, detail="Sblocca il PDF prima di comprimerlo")
    output_path = resolved_output_path(source_path, req.output_path)
    settings = {"quality": (82, 0), "balanced": (65, 0), "small": (48, 1)}
    if req.quality not in settings:
        document.close()
        raise HTTPException(status_code=400, detail="Livello di compressione non valido")
    jpeg_quality, shrink = settings[req.quality]
    replaced = 0
    visited = set()
    try:
        for page in document:
            for image in page.get_images(full=True):
                xref = image[0]
                if xref in visited:
                    continue
                visited.add(xref)
                try:
                    pixmap = fitz.Pixmap(document, xref)
                    if pixmap.width * pixmap.height < 40_000 or pixmap.colorspace is None:
                        continue
                    if pixmap.alpha or pixmap.n > 3:
                        pixmap = fitz.Pixmap(fitz.csRGB, pixmap)
                    if shrink and min(pixmap.width, pixmap.height) >= 600:
                        pixmap.shrink(shrink)
                    compressed = pixmap.tobytes("jpeg", jpg_quality=jpeg_quality)
                    page.replace_image(xref, stream=compressed)
                    replaced += 1
                except Exception:
                    continue
        original_size = source_path.stat().st_size
        atomic_save(document, output_path, clean=True)
        return {
            "status": "ok",
            "output_path": str(output_path),
            "original_size": original_size,
            "final_size": output_path.stat().st_size,
            "images_recompressed": replaced,
        }
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"Compressione non riuscita: {error}") from error


def ocr_helper_path() -> Optional[Path]:
    candidates = [
        Path(sys.executable).resolve().parent / "mac-pdf-ocr",
        Path(__file__).resolve().parent.parent / "dist" / "mac-pdf-ocr",
    ]
    return next((candidate for candidate in candidates if candidate.is_file()), None)


def int_to_pdf_color(value: int) -> Tuple[float, float, float]:
    color = max(0, min(0xFFFFFF, int(value)))
    return ((color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255)


def sampled_image_colors(pixmap: fitz.Pixmap, rect: fitz.Rect, page_rect: fitz.Rect) -> Tuple[int, int]:
    """Stima sfondo e testo di una riga OCR usando i pixel più rappresentativi."""
    scale_x = pixmap.width / page_rect.width
    scale_y = pixmap.height / page_rect.height
    x0 = max(0, min(pixmap.width - 1, int(rect.x0 * scale_x)))
    y0 = max(0, min(pixmap.height - 1, int(rect.y0 * scale_y)))
    x1 = max(x0 + 1, min(pixmap.width, int(rect.x1 * scale_x)))
    y1 = max(y0 + 1, min(pixmap.height, int(rect.y1 * scale_y)))
    step_x = max(1, (x1 - x0) // 120)
    step_y = max(1, (y1 - y0) // 24)
    samples = pixmap.samples
    components = pixmap.n
    colors: Counter[Tuple[int, int, int]] = Counter()
    for y in range(y0, y1, step_y):
        for x in range(x0, x1, step_x):
            offset = (y * pixmap.width + x) * components
            red, green, blue = samples[offset:offset + 3]
            colors[(red // 16 * 16, green // 16 * 16, blue // 16 * 16)] += 1
    if not colors:
        return 0xFFFFFF, 0x000000
    background, background_count = colors.most_common(1)[0]
    candidates = [item for item in colors.most_common(32) if item[1] >= max(2, background_count // 250)]
    foreground = max(
        candidates,
        key=lambda item: sum((item[0][channel] - background[channel]) ** 2 for channel in range(3)),
    )[0]
    distance = sum((foreground[channel] - background[channel]) ** 2 for channel in range(3)) ** 0.5
    if distance < 70:
        foreground = (0, 0, 0) if sum(background) > 380 else (255, 255, 255)
    to_int = lambda rgb: (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
    return to_int(background), to_int(foreground)


def ocr_spans_inside_images(source_path: Path, page_num: int, page: fitz.Page, native_spans: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    helper = ocr_helper_path()
    if not helper:
        return []
    stat = source_path.stat()
    cache_key = (str(source_path), stat.st_mtime_ns, stat.st_size, page_num)
    if cache_key in OCR_INSPECTION_CACHE:
        return OCR_INSPECTION_CACHE[cache_key]

    rect_area = lambda rect: max(0.0, rect.width) * max(0.0, rect.height)
    page_area = rect_area(page.rect)
    image_rects = [
        fitz.Rect(info["bbox"])
        for info in page.get_image_info(xrefs=True)
        if rect_area(fitz.Rect(info["bbox"])) >= page_area * 0.015
    ]
    if not image_rects:
        OCR_INSPECTION_CACHE[cache_key] = []
        return []

    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    with tempfile.TemporaryDirectory(prefix="mac-pdf-inspect-") as directory:
        image_path = Path(directory) / f"page-{page_num + 1}.png"
        pixmap.save(image_path)
        process = subprocess.run(
            [str(helper), str(image_path), "it-IT,en-US"],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    if process.returncode != 0:
        return []

    native_rects = [fitz.Rect(span["bbox"]) for span in native_spans if span.get("text", "").strip()]
    recognized: List[Dict[str, Any]] = []
    for observation in json.loads(process.stdout or "[]"):
        text = str(observation.get("text", "")).strip()
        bbox = observation.get("bbox", [])
        if not text or len(bbox) != 4:
            continue
        x, y, width, height = map(float, bbox)
        rect = fitz.Rect(
            x * page.rect.width,
            (1 - y - height) * page.rect.height,
            (x + width) * page.rect.width,
            (1 - y) * page.rect.height,
        )
        center = fitz.Point((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2)
        if not any(image_rect.contains(center) for image_rect in image_rects):
            continue
        if any((rect_area(rect & native_rect) / max(rect_area(rect), 1)) > 0.45 for native_rect in native_rects):
            continue
        background, foreground = sampled_image_colors(pixmap, rect, page.rect)
        font_size = max(5.0, min(72.0, rect.height * 0.82))
        recognized.append({
            "text": text,
            "bbox": list(rect),
            "origin": [rect.x0, rect.y1 - max(0.8, rect.height * 0.12)],
            "font": "Helvetica",
            "font_resource": "helv",
            "size": font_size,
            "color": foreground,
            "background_color": background,
            "ascender": 1.0,
            "descender": -0.2,
            "source": "ocr",
        })

    if len(OCR_INSPECTION_CACHE) >= 48:
        OCR_INSPECTION_CACHE.pop(next(iter(OCR_INSPECTION_CACHE)))
    OCR_INSPECTION_CACHE[cache_key] = recognized
    return recognized


def native_text_spans(page: fitz.Page) -> List[Dict[str, Any]]:
    spans: List[Dict[str, Any]] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                spans.append({
                    "text": span["text"],
                    "bbox": span["bbox"],
                    "origin": span["origin"],
                    "font": span["font"],
                    "font_resource": font_resource_for_span(page, span["font"]),
                    "size": span["size"],
                    "color": span["color"],
                    "ascender": span.get("ascender"),
                    "descender": span.get("descender"),
                    "source": "native",
                })
    return spans


def page_text_spans(
    source_path: Path,
    page_num: int,
    page: fitz.Page,
    include_ocr: bool = True,
) -> Tuple[List[Dict[str, Any]], int]:
    spans = native_text_spans(page)
    ocr_spans = ocr_spans_inside_images(source_path, page_num, page, spans) if include_ocr else []
    spans.extend(ocr_spans)
    return spans, len(ocr_spans)


def normalized_repeated_text(value: str) -> str:
    return " ".join(str(value or "").split())


def text_match_context(page: fitz.Page, span: Dict[str, Any]) -> str:
    if span.get("source") == "ocr":
        return normalized_repeated_text(span.get("text", ""))
    rect = fitz.Rect(span["bbox"])
    line_rect = fitz.Rect(
        0,
        max(0, rect.y0 - max(4, rect.height * 0.4)),
        page.rect.width,
        min(page.rect.height, rect.y1 + max(4, rect.height * 0.4)),
    )
    context = normalized_repeated_text(page.get_textbox(line_rect))
    return context[:180] if context else normalized_repeated_text(span.get("text", ""))


@app.post("/ocr-pdf")
def ocr_pdf(req: OcrRequest):
    source_path, document = open_pdf_path(req.file_path)
    if document.needs_pass:
        document.close()
        raise HTTPException(status_code=423, detail="Sblocca il PDF prima di eseguire l'OCR")
    helper = ocr_helper_path()
    if not helper:
        document.close()
        raise HTTPException(status_code=503, detail="Motore OCR locale non disponibile")
    output_path = resolved_output_path(source_path, req.output_path)
    page_nums = req.page_nums if req.page_nums is not None else list(range(document.page_count))
    if not page_nums or any(page_num < 0 or page_num >= document.page_count for page_num in page_nums):
        document.close()
        raise HTTPException(status_code=400, detail="Pagine OCR non valide")

    recognized = 0
    skipped = 0
    temp_dir = Path(tempfile.mkdtemp(prefix="mac-pdf-ocr-"))
    try:
        for page_num in page_nums:
            page = document[page_num]
            if not req.force and len(page.get_text().strip()) >= 20:
                skipped += 1
                continue
            image_path = temp_dir / f"page-{page_num + 1}.png"
            page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(image_path)
            process = subprocess.run(
                [str(helper), str(image_path), "it-IT,en-US"],
                capture_output=True,
                text=True,
                timeout=120,
                check=False,
            )
            if process.returncode != 0:
                raise HTTPException(status_code=422, detail=process.stderr.strip() or "OCR non riuscito")
            observations = json.loads(process.stdout or "[]")
            for observation in observations:
                text = str(observation.get("text", "")).strip()
                bbox = observation.get("bbox", [])
                if not text or len(bbox) != 4:
                    continue
                x, y, width, height = map(float, bbox)
                rect = fitz.Rect(
                    x * page.rect.width,
                    (1 - y - height) * page.rect.height,
                    (x + width) * page.rect.width,
                    (1 - y) * page.rect.height,
                )
                font_size = max(4.0, min(36.0, rect.height * 0.78))
                result = page.insert_textbox(
                    rect, text, fontsize=font_size, fontname="helv",
                    render_mode=3, overlay=True,
                )
                if result < 0:
                    page.insert_text(
                        rect.bl, text, fontsize=font_size, fontname="helv",
                        render_mode=3, overlay=True,
                    )
                recognized += 1
        atomic_save(document, output_path)
        return {
            "status": "ok",
            "output_path": str(output_path),
            "recognized": recognized,
            "skipped_pages": skipped,
            "processed_pages": len(page_nums) - skipped,
        }
    except HTTPException:
        if not document.is_closed:
            document.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"OCR non riuscito: {error}") from error
    finally:
        for item in temp_dir.glob("*"):
            item.unlink(missing_ok=True)
        temp_dir.rmdir()


@app.post("/pdf-info")
def pdf_info(req: PdfInfoRequest):
    _, document = open_pdf_path(req.file_path)
    try:
        return {
            "needs_password": bool(document.needs_pass),
            "is_encrypted": bool(document.is_encrypted),
            "page_count": 0 if document.needs_pass else document.page_count,
        }
    finally:
        document.close()


@app.post("/unlock-pdf")
def unlock_pdf(req: UnlockPdfRequest):
    source_path, document = open_pdf_path(req.file_path)
    output_path = resolved_output_path(source_path, req.output_path)
    try:
        if document.needs_pass and not document.authenticate(req.password):
            raise HTTPException(status_code=401, detail="Password non corretta")
        page_count = document.page_count
        atomic_save(document, output_path, encryption=fitz.PDF_ENCRYPT_NONE)
        return {"status": "ok", "output_path": str(output_path), "page_count": page_count}
    except HTTPException:
        if not document.is_closed:
            document.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"Sblocco non riuscito: {error}") from error


@app.post("/reorder-pages")
def reorder_pages(req: ReorderPagesRequest):
    source_path, document = open_pdf_path(req.file_path)
    output_path = resolved_output_path(source_path, req.output_path)
    try:
        if document.needs_pass:
            raise HTTPException(status_code=423, detail="Sblocca il PDF prima di organizzare le pagine")
        expected = list(range(document.page_count))
        if len(req.order) != document.page_count or sorted(req.order) != expected:
            raise HTTPException(status_code=400, detail="L'ordine delle pagine non è valido")
        document.select(req.order)
        atomic_save(document, output_path)
        return {"status": "ok", "output_path": str(output_path), "page_count": len(req.order)}
    except HTTPException:
        if not document.is_closed:
            document.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"Riordino non riuscito: {error}") from error


@app.post("/insert-pdf")
def insert_pdf(req: InsertPdfRequest):
    source_path, document = open_pdf_path(req.file_path)
    _, inserted = open_pdf_path(req.insert_file_path, "PDF da inserire non trovato")
    output_path = resolved_output_path(source_path, req.output_path)
    try:
        if document.needs_pass:
            raise HTTPException(status_code=423, detail="Sblocca il PDF principale prima di inserire pagine")
        if inserted.needs_pass and not inserted.authenticate(req.insert_password or ""):
            raise HTTPException(status_code=401, detail="Il PDF da inserire richiede una password")
        if req.insert_at < 0 or req.insert_at > document.page_count:
            raise HTTPException(status_code=400, detail="Posizione di inserimento non valida")
        inserted_count = inserted.page_count
        document.insert_pdf(inserted, start_at=req.insert_at)
        final_page_count = document.page_count
        inserted.close()
        atomic_save(document, output_path)
        return {
            "status": "ok",
            "output_path": str(output_path),
            "inserted_count": inserted_count,
            "page_count": final_page_count,
        }
    except HTTPException:
        if not document.is_closed:
            document.close()
        if not inserted.is_closed:
            inserted.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        if not inserted.is_closed:
            inserted.close()
        raise HTTPException(status_code=500, detail=f"Inserimento non riuscito: {error}") from error


@app.post("/add-image")
def add_image(req: AddImageRequest):
    source_path, document = validate_document(req.file_path, req.page_num)
    output_path = resolved_output_path(source_path, req.output_path)
    try:
        page = document[req.page_num]
        rect = fitz.Rect(req.rect)
        if rect.is_empty or rect.is_infinite or not page.rect.contains(rect):
            raise HTTPException(status_code=400, detail="Posizione o dimensione dell'immagine non valida")
        image_bytes = decode_image_data(req.image_data)
        try:
            page.insert_image(rect, stream=image_bytes, keep_proportion=False, overlay=True)
        except Exception as error:
            raise HTTPException(status_code=422, detail=f"Formato immagine non supportato: {error}") from error
        atomic_save(document, output_path)
        return {"status": "ok", "output_path": str(output_path)}
    except HTTPException:
        if not document.is_closed:
            document.close()
        raise
    except Exception as error:
        if not document.is_closed:
            document.close()
        raise HTTPException(status_code=500, detail=f"Inserimento immagine non riuscito: {error}") from error


@app.post("/inspect-text")
def inspect_text(req: InspectRequest):
    source_path, document = validate_document(req.file_path, req.page_num)
    try:
        page = document[req.page_num]
        text_spans, ocr_count = page_text_spans(source_path, req.page_num, page)

        return {
            "page_num": req.page_num,
            "page_width": page.rect.width,
            "page_height": page.rect.height,
            "spans": text_spans,
            "ocr_spans": ocr_count,
        }
    finally:
        document.close()


@app.post("/search-text")
def search_text(req: SearchTextRequest):
    query = " ".join(req.query.split())
    if not query:
        raise HTTPException(status_code=400, detail="Inserisci il testo da cercare")

    _, document = open_pdf_path(req.file_path)
    if document.needs_pass:
        document.close()
        raise HTTPException(status_code=423, detail="Sblocca il PDF prima della ricerca")

    matches: List[Dict[str, Any]] = []
    truncated = False
    try:
        for page_num in range(document.page_count):
            page = document[page_num]
            for rect in page.search_for(query):
                matches.append({
                    "page_num": page_num,
                    "bbox": [rect.x0, rect.y0, rect.x1, rect.y1],
                })
                if len(matches) >= req.max_results:
                    truncated = True
                    break
            if truncated:
                break
        return {
            "status": "ok",
            "query": query,
            "page_count": document.page_count,
            "matches": matches,
            "truncated": truncated,
        }
    finally:
        document.close()


@app.post("/find-repeated-text")
def find_repeated_text(req: FindRepeatedTextRequest):
    query = normalized_repeated_text(req.text)
    if not query:
        raise HTTPException(status_code=400, detail="Seleziona un testo da cercare")

    source_path, document = open_pdf_path(req.file_path)
    if document.needs_pass:
        document.close()
        raise HTTPException(status_code=423, detail="Sblocca il PDF prima della ricerca")

    matches: List[Dict[str, Any]] = []
    try:
        for page_num in range(document.page_count):
            page = document[page_num]
            spans, _ = page_text_spans(
                source_path,
                page_num,
                page,
                include_ocr=req.include_ocr,
            )
            for span in spans:
                if normalized_repeated_text(span.get("text", "")) != query:
                    continue
                matches.append({
                    **span,
                    "page_num": page_num,
                    "context": text_match_context(page, span),
                })
        return {
            "status": "ok",
            "query": query,
            "page_count": document.page_count,
            "matches": matches,
        }
    finally:
        document.close()


@app.post("/batch-edit-text")
def batch_edit_text(req: BatchEditTextRequest):
    source_path, document = open_pdf_path(req.file_path)
    if document.needs_pass:
        document.close()
        raise HTTPException(status_code=423, detail="Sblocca il PDF prima della modifica")

    output_path = resolved_output_path(source_path, req.output_path)
    save_path = output_path.with_name(f".{output_path.stem}-{uuid.uuid4().hex}.tmp.pdf")

    prepared_by_page: Dict[int, List[Tuple[BatchTextChange, Optional[str], str]]] = {}
    seen_locations = set()
    try:
        # Tutti i font vengono verificati prima della prima redazione: se una
        # sola sostituzione non è rappresentabile, il PDF originale resta intatto.
        for change in req.changes:
            if change.page_num >= document.page_count:
                raise HTTPException(status_code=400, detail="Una pagina selezionata non esiste più")
            page = document[change.page_num]
            rect = fitz.Rect(change.bbox)
            if rect.is_empty or rect.is_infinite or not page.rect.intersects(rect):
                raise HTTPException(status_code=400, detail="Coordinate di una corrispondenza non valide")

            location_key = (
                change.page_num,
                *(round(float(value), 2) for value in change.bbox),
                change.source,
            )
            if location_key in seen_locations:
                raise HTTPException(status_code=400, detail="La stessa corrispondenza è stata selezionata due volte")
            seen_locations.add(location_key)

            font_resource = None
            font_used = change.font
            if req.new_text:
                font_resource, font_used = resolve_text_font(
                    page,
                    change.font,
                    change.font_resource,
                    req.new_text,
                    allow_original_resource=change.source != "ocr",
                )
            prepared_by_page.setdefault(change.page_num, []).append(
                (change, font_resource, font_used)
            )

        fonts_used = set()
        for page_num, prepared_changes in prepared_by_page.items():
            page = document[page_num]
            redact_images = any(change.source == "ocr" for change, _, _ in prepared_changes)
            for change, _, _ in prepared_changes:
                page.add_redact_annot(
                    fitz.Rect(change.bbox),
                    fill=(
                        int_to_pdf_color(change.background_color)
                        if change.source == "ocr"
                        else None
                    ),
                    cross_out=False,
                )
            page.apply_redactions(images=2 if redact_images else 0, graphics=0, text=0)

            if req.new_text:
                for change, font_resource, font_used in prepared_changes:
                    try:
                        page.insert_text(
                            fitz.Point(change.origin),
                            req.new_text,
                            fontname=font_resource,
                            fontsize=change.size,
                            color=fitz.sRGB_to_pdf(change.color),
                            overlay=True,
                        )
                        fonts_used.add(font_used)
                    except Exception as error:
                        raise HTTPException(
                            status_code=422,
                            detail=f"Una sostituzione non può usare il font originale: {error}",
                        ) from error

        document.save(save_path, garbage=4, deflate=True, preserve_metadata=True)
        document.close()
        os.replace(save_path, output_path)

        return {
            "status": "ok",
            "output_path": str(output_path),
            "changed_count": len(req.changes),
            "fonts_used": sorted(fonts_used),
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Modifica coerente non riuscita: {error}") from error
    finally:
        if not document.is_closed:
            document.close()
        save_path.unlink(missing_ok=True)


@app.post("/edit-text")
def edit_text(req: EditTextRequest):
    source_path, document = validate_document(req.file_path, req.page_num)
    output_path = (
        Path(req.output_path).expanduser().resolve()
        if req.output_path
        else temporary_output_path(source_path)
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_path = output_path.with_name(f".{output_path.stem}-{uuid.uuid4().hex}.tmp.pdf")

    try:
        page = document[req.page_num]
        rect = fitz.Rect(req.bbox)
        if rect.is_empty or rect.is_infinite or not page.rect.intersects(rect):
            raise HTTPException(status_code=400, detail="Coordinate del testo non valide")

        is_ocr_text = req.source == "ocr"
        font_resource = None
        font_used = req.font
        if req.new_text:
            # Preflight prima della redazione: un glifo mancante non deve mai
            # cancellare il contenuto originale lasciando il riquadro vuoto.
            font_resource, font_used = resolve_text_font(
                page,
                req.font,
                req.font_resource,
                req.new_text,
                allow_original_resource=not is_ocr_text,
            )

        # Per testo nativo elimina solo i glifi. Per testo dentro un'immagine
        # ricostruisce invece i pixel della piccola area usando lo sfondo stimato.
        page.add_redact_annot(
            rect,
            fill=int_to_pdf_color(req.background_color) if is_ocr_text else None,
            cross_out=False,
        )
        page.apply_redactions(images=2 if is_ocr_text else 0, graphics=0, text=0)

        if req.new_text:
            try:
                page.insert_text(
                    fitz.Point(req.origin),
                    req.new_text,
                    fontname=font_resource,
                    fontsize=req.size,
                    color=fitz.sRGB_to_pdf(req.color),
                    overlay=True,
                )
            except Exception as error:
                raise HTTPException(
                    status_code=422,
                    detail=f"Il font originale non può rappresentare il nuovo testo: {error}",
                ) from error

        document.save(save_path, garbage=4, deflate=True, preserve_metadata=True)
        document.close()
        os.replace(save_path, output_path)

        return {
            "status": "ok",
            "output_path": str(output_path),
            "font_used": font_used,
            "font_resource": font_resource,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Modifica non riuscita: {error}") from error
    finally:
        if not document.is_closed:
            document.close()
        if save_path.exists():
            save_path.unlink(missing_ok=True)


@app.post("/add-text")
def add_text(req: AddTextRequest):
    if not req.new_text:
        raise HTTPException(status_code=400, detail="Inserisci il testo da aggiungere")

    source_path, document = validate_document(req.file_path, req.page_num)
    output_path = (
        Path(req.output_path).expanduser().resolve()
        if req.output_path
        else temporary_output_path(source_path)
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_path = output_path.with_name(f".{output_path.stem}-{uuid.uuid4().hex}.tmp.pdf")

    try:
        page = document[req.page_num]
        origin = fitz.Point(req.origin)
        if not page.rect.contains(origin):
            raise HTTPException(status_code=400, detail="Il punto di inserimento è fuori dalla pagina")

        font_resource, font_used = resolve_text_font(
            page,
            req.font,
            req.font_resource,
            req.new_text,
        )

        try:
            page.insert_text(
                origin,
                req.new_text,
                fontname=font_resource,
                fontsize=req.size,
                color=fitz.sRGB_to_pdf(req.color),
                overlay=True,
            )
        except Exception as error:
            raise HTTPException(
                status_code=422,
                detail=f"Il font scelto non può rappresentare il nuovo testo: {error}",
            ) from error

        document.save(save_path, garbage=4, deflate=True, preserve_metadata=True)
        document.close()
        os.replace(save_path, output_path)

        return {
            "status": "ok",
            "output_path": str(output_path),
            "font_used": font_used,
            "font_resource": font_resource,
        }
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Inserimento non riuscito: {error}") from error
    finally:
        if not document.is_closed:
            document.close()
        if save_path.exists():
            save_path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    backend_port = int(os.environ.get("MAC_PDF_EDITOR_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=backend_port, log_level="info")
