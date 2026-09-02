# Third-party notices

Tomorrow Now PDF Editor incorporates third-party software. The notices below
are provided for attribution and do not replace the full license text shipped
by each upstream project.

## Application runtime

| Component | Version used | License | Project |
| --- | ---: | --- | --- |
| PyMuPDF | 1.26.5 | GNU AGPL v3 or Artifex commercial license | <https://pymupdf.io/> |
| FastAPI | 0.128.8 | MIT | <https://fastapi.tiangolo.com/> |
| Starlette | transitive dependency | BSD-3-Clause | <https://www.starlette.io/> |
| Pydantic | 2.13.4 | MIT | <https://docs.pydantic.dev/> |
| Uvicorn | 0.39.0 | BSD-3-Clause | <https://www.uvicorn.org/> |
| Electron | 28.x | MIT | <https://www.electronjs.org/> |
| electron-updater | 6.8.x | MIT | <https://www.electron.build/auto-update.html> |
| PDF.js / pdfjs-dist | 3.11.x | Apache-2.0 | <https://mozilla.github.io/pdf.js/> |

## Build tooling

| Component | Version used | License | Project |
| --- | ---: | --- | --- |
| PyInstaller | 6.16.0 | GPL-2.0-or-later with a special exception for distributing bundled applications | <https://pyinstaller.org/> |
| electron-builder | 26.x | MIT | <https://www.electron.build/> |
| @electron/notarize | 2.5.0 | MIT | <https://github.com/electron/notarize> |

## Bundled fonts

The desktop application contains Caladea, Carlito and Liberation fonts under
the SIL Open Font License 1.1. Their upstream license files are included next
to the corresponding font files in `assets/fonts/licenses/`.

## Apple Vision OCR helper

The local OCR helper calls Apple Vision APIs available on macOS. Apple and
macOS are trademarks of Apple Inc. No Apple code is redistributed by this
repository.

## Source availability

The application source is licensed under GNU Affero General Public License
version 3. The license text is in `LICENSE`. Exact dependency license texts can
also be found in the installed packages and their linked upstream projects.
