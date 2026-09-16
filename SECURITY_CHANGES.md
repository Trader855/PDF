# Security hardening — release 1.6.0

These controls are part of the 1.6.0 desktop release source. Distribution is
allowed only after the signed and notarized Mac package passes the release gate
below; Windows remains an explicitly unsigned validation build.

Implemented: Electron 44.1.1, PDF.js 6.3.289 with explicit `isEvalSupported:
false`; ESM worker and bundled font/CMap/Wasm resources; no renderer backend
token or localhost fetch; private stdin credential, inherited readiness pipe,
OS-assigned loopback port, no redirect following; endpoint/file allowlists;
one-use native save destination and atomic save; private session directories,
normal exit/parent EOF/stale-session cleanup; permission denial and main-frame
IPC validation; native application password dialog; bounded lazy thumbnails,
PDF size/page limits, bounded OCR rasterization/timeouts and native-only
document-wide matching; transparency/CMYK-preserving compression; signature
storage quota handling and deletion control; log rotation at startup.

## Release gate and remaining work

- `pnpm test`: Python font/edit/form/page regressions and Node security tests
  against a real Python process (auth, port conflict, file boundaries, passwords,
  font bytes, insertion, modification, session cleanup).
- `MAC_PDF_EDITOR_REGRESSION_PDF=/path/file.pdf pnpm run test:backend`: optional
  private real-world font fixture; do not commit or upload it.
- `PLAYWRIGHT_MODULE=/path/to/playwright node scripts/qa_desktop_ui.cjs`:
  isolated desktop UI check. Uses a disposable profile, not the user's files.
- `pnpm run test:packaged`: same backend contract against the built app.

Before distributing the DMG: run packaged tests, full UI regression and
sign/notarize/verify the final binary; review hardened-runtime entitlements
and PyInstaller one-file packaging. Existing permissive signing entitlements
have intentionally not been removed without a signed-package compatibility
test. Test all supported macOS versions, cancellation and memory pressure
with a wider hostile-PDF corpus. This work is not a complete penetration test
or proof that every report item is resolved.

Verified locally on 3 September: 23 Python tests, including the optional private
AXA font fixture; 4 Node security tests; the same 4 tests against the packaged
backend; desktop UI open/edit/font switch/page 25/encrypted insertion to 50
pages; web smoke tests, lint and production build; production npm dependency
audit (no known advisories returned). The UI check also caught and fixed font
resources being pruned by redaction and the PDF.js 6 loading-task lifecycle.
The packaged test build was deliberately unsigned and stored separately from
existing release assets. Signing/notarization checks remain outstanding.
Build the release backend with a supported Python runtime and retain the exact
test, signature, notarization and Gatekeeper evidence with the release.

Browser source is maintained separately in
`https://github.com/Tomorrow-Now-Tech/pdf-editor`. Privacy and terms still need
professional review as the public product evolves.
