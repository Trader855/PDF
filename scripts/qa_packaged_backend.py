#!/usr/bin/env python3
"""Smoke test HTTP del backend realmente incluso nell'app macOS."""

import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

import fitz


PROJECT_ROOT = Path(__file__).resolve().parent.parent
APP_RESOURCES = (
    PROJECT_ROOT
    / "release"
    / "mac-arm64"
    / "Mac PDF Editor.app"
    / "Contents"
    / "Resources"
)
BACKEND = APP_RESOURCES / "backend" / "mac-pdf-backend"
FONTS = APP_RESOURCES / "fonts"
API_BASE = "http://127.0.0.1:8000"
BASELINE_TEXT = "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz àèéìòù €%"


def request_json(method: str, endpoint: str, body=None, expected_status: int = 200):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        API_BASE + endpoint,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            status = response.status
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        status = error.code
        payload = json.loads(error.read().decode("utf-8"))
    if status != expected_status:
        raise AssertionError(f"{method} {endpoint}: atteso {expected_status}, ricevuto {status}: {payload}")
    return payload


def create_source_pdf(path: Path) -> None:
    document = fitz.open()
    page = document.new_page(width=595, height=842)
    page.insert_text((72, 90), "DATA INCASSO", fontname="helv", fontsize=11)
    page.insert_text((180, 90), "05/08/2026", fontname="helv", fontsize=11)
    document.save(path)
    document.close()


def test_real_world_font_if_configured(temp_path: Path) -> bool:
    configured = os.environ.get("MAC_PDF_EDITOR_REGRESSION_PDF")
    if not configured:
        return False
    source = Path(configured).expanduser().resolve()
    if not source.is_file():
        raise AssertionError(f"PDF reale non trovato: {source}")

    with fitz.open(source) as document:
        page = document[0]
        resource = next(
            font[4]
            for font in page.get_fonts(full=True)
            if "franklin" in str(font[3]).casefold()
            and str(font[2]).casefold() != "type0"
            and "identity" not in str(font[5]).casefold()
        )

    output = temp_path / "real-world-number-6.pdf"
    result = request_json(
        "POST",
        "/add-text",
        {
            "file_path": str(source),
            "output_path": str(output),
            "page_num": 0,
            "origin": [250, 500],
            "new_text": "06/08/2026",
            "font": "FranklinGothic-Book",
            "font_resource": resource,
            "size": 10,
            "color": 0,
        },
    )
    if result.get("font_used") != "Liberation Sans":
        raise AssertionError(f"Il font Franklin incompleto non ha attivato il fallback: {result}")
    with fitz.open(output) as document:
        if "06/08/2026" not in document[0].get_text():
            raise AssertionError("Il numero 6 non sopravvive nel PDF reale")
    return True


def wait_for_backend(process: subprocess.Popen) -> None:
    last_error = None
    # Il primo avvio di un eseguibile PyInstaller può impiegare diversi secondi
    # per estrarre i componenti firmati, soprattutto subito dopo la build.
    for _ in range(300):
        if process.poll() is not None:
            stdout, stderr = process.communicate(timeout=2)
            raise RuntimeError(
                f"Il backend impacchettato è terminato con codice {process.returncode}.\n"
                f"stdout: {stdout}\nstderr: {stderr}"
            )
        try:
            health = request_json("GET", "/health")
            if health.get("status") == "ok":
                return
        except Exception as error:
            last_error = error
        time.sleep(0.1)
    raise RuntimeError(f"Il backend impacchettato non risponde: {last_error}")


def main() -> None:
    global API_BASE
    if not BACKEND.is_file():
        raise SystemExit(f"Backend impacchettato non trovato: {BACKEND}")
    if not FONTS.is_dir():
        raise SystemExit(f"Cartella font impacchettata non trovata: {FONTS}")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        backend_port = probe.getsockname()[1]
    API_BASE = f"http://127.0.0.1:{backend_port}"

    environment = os.environ.copy()
    environment["MAC_PDF_EDITOR_FONTS_DIR"] = str(FONTS)
    environment["MAC_PDF_EDITOR_PORT"] = str(backend_port)
    process = subprocess.Popen(
        [str(BACKEND)],
        cwd=str(BACKEND.parent),
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        wait_for_backend(process)
        fonts = request_json("GET", "/fonts").get("fonts", [])
        if len(fonts) != 20:
            raise AssertionError(f"Attesi 20 font impacchettati, trovati {len(fonts)}")

        with tempfile.TemporaryDirectory(prefix="mac-pdf-editor-packaged-qa-") as directory:
            temp_path = Path(directory)
            source = temp_path / "source.pdf"
            added = temp_path / "added.pdf"
            edited = temp_path / "edited.pdf"
            unsupported = temp_path / "unsupported.pdf"
            create_source_pdf(source)

            add_result = request_json(
                "POST",
                "/add-text",
                {
                    "file_path": str(source),
                    "output_path": str(added),
                    "page_num": 0,
                    "origin": [50, 150],
                    "new_text": BASELINE_TEXT,
                    "font": "FranklinGothic-Book",
                    "size": 8,
                    "color": 0,
                },
            )
            if add_result.get("font_used") != "Liberation Sans":
                raise AssertionError(f"Fallback font inatteso: {add_result}")
            with fitz.open(added) as document:
                extracted = document[0].get_text().replace("\n", " ")
            if BASELINE_TEXT not in extracted:
                raise AssertionError("Il testo base non sopravvive a salvataggio e riapertura")

            inspected = request_json(
                "POST", "/inspect-text", {"file_path": str(source), "page_num": 0}
            )
            searched = request_json(
                "POST", "/search-text", {"file_path": str(source), "query": "incasso"}
            )
            if len(searched.get("matches", [])) != 1:
                raise AssertionError(f"Ricerca testuale inattesa: {searched}")
            span = next(item for item in inspected["spans"] if item["text"] == "05/08/2026")
            request_json(
                "POST",
                "/edit-text",
                {
                    "file_path": str(source),
                    "output_path": str(edited),
                    "page_num": 0,
                    "bbox": span["bbox"],
                    "origin": span["origin"],
                    "new_text": "06/08/2026",
                    "font": span["font"],
                    "font_resource": span["font_resource"],
                    "size": span["size"],
                    "color": span["color"],
                },
            )
            with fitz.open(edited) as document:
                edited_text = document[0].get_text()
            if "06/08/2026" not in edited_text or "05/08/2026" in edited_text:
                raise AssertionError("La modifica della data non sopravvive a salvataggio e riapertura")

            request_json(
                "POST",
                "/add-text",
                {
                    "file_path": str(source),
                    "output_path": str(unsupported),
                    "page_num": 0,
                    "origin": [72, 200],
                    "new_text": "😀",
                    "font": "FranklinGothic-Book",
                    "size": 11,
                },
                expected_status=422,
            )
            if unsupported.exists():
                raise AssertionError("Un carattere non supportato ha creato un PDF incompleto")

            real_world_checked = test_real_world_font_if_configured(temp_path)

        print("QA backend impacchettato: OK")
        print("- 20 font presenti")
        print("- cifre, lettere, accenti e simboli salvati e riaperti")
        print("- modifica 05/08/2026 -> 06/08/2026 verificata")
        print("- ricerca testuale parziale verificata")
        print("- caratteri non supportati bloccati senza perdita del testo")
        if real_world_checked:
            print("- font Franklin incompleto verificato sul PDF reale AXA")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


if __name__ == "__main__":
    main()
