const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const { virtualEnvironmentPython } = require('../platform-runtime');
const root = path.resolve(__dirname, '..');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-electron-qa-'));
  const documents = path.join(temp, 'Documenti Àccentati');
  fs.mkdirSync(documents);
  const source = path.join(documents, 'relazione finale.pdf');
  const locked = path.join(documents, 'allegato protetto.pdf');
  const scanned = path.join(documents, 'scansione sintetica.pdf');
  const unknownFont = path.join(documents, 'native.pdf');
  execFileSync(virtualEnvironmentPython(root), ['-c',
    'import fitz,sys; from pathlib import Path; p=Path(sys.argv[1]); d=fitz.open(); [(d.new_page().insert_text((72,72),"DATA 05/08/2026 PAGINA %d"%i)) for i in range(1,26)]; d.save(p/"relazione finale.pdf"); d.save(p/"allegato protetto.pdf",encryption=fitz.PDF_ENCRYPT_AES_256,owner_pw="owner",user_pw="test-password"); d.close(); d=fitz.open(); s=d.new_page(width=595,height=400); s.insert_text((72,140),"SCANSIONE 05/08/2026",fontsize=32); png=s.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False).tobytes("png"); d.close(); d=fitz.open(); s=d.new_page(width=595,height=400); s.insert_image(s.rect,stream=png); d.save(p/"scansione sintetica.pdf"); d.close()', documents]);
  execFileSync(virtualEnvironmentPython(root), ['-c',
    'import sys; from pathlib import Path; sys.path.insert(0,"tests"); from test_font_edit_safety import FontEditSafetyTests; t=FontEditSafetyTests(); t.root=Path(sys.argv[1]); t.native_fixture(pages=2)', documents], { cwd: root });
  const errors = [];
  console.log('QA: launch isolated Electron');
  const application = await _electron.launch({ executablePath: require('electron'),
    args: [path.join(root, 'tests/electron-entry.cjs')], cwd: root,
    env: { ...process.env, QA_USER_DATA: path.join(temp, 'profile') } });
  const page = await application.firstWindow();
  try {
    console.log('QA: window ready');
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') { console.log('Renderer error:', message.text()); errors.push(message.text()); } });
    await page.waitForFunction(() => !!window.desktopAPI && !!document.querySelector('#pdf-file-input'));
    assert.equal(await page.evaluate(() => window.desktopAPI.platform), process.platform);
    for (const width of [1000, 1280, 1600]) {
      await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size, 850), width);
      await page.waitForFunction(expected => window.outerWidth === expected, width);
      const banner = await page.locator('#tomorrow-now-banner').evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const title = element.querySelector('strong');
        const motto = element.querySelector('.tomorrow-now-motto');
        const cta = element.querySelector('.tomorrow-now-cta');
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
          .map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
          .reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
        const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        const backgrounds = getComputedStyle(element).backgroundImage.match(/rgba?\([^)]+\)/g).map(luminance);
        const contrastRatios = [title, motto].flatMap(node => backgrounds.map(background =>
          contrast(luminance(getComputedStyle(node).color), background)));
        contrastRatios.push(contrast(luminance(getComputedStyle(cta).color), luminance(getComputedStyle(cta).backgroundColor)));
        const inside = node => {
          const box = node.getBoundingClientRect();
          return box.x >= bounds.x && box.right <= bounds.right && box.y >= bounds.y && box.bottom <= bounds.bottom;
        };
        return { title: title.textContent, motto: motto.textContent, height: bounds.height,
          titleSize: parseFloat(getComputedStyle(title).fontSize), mottoSize: parseFloat(getComputedStyle(motto).fontSize),
          contrast: Math.min(...contrastRatios),
          visible: [title, motto, cta].every(inside) && getComputedStyle(motto).display !== 'none',
          noOverlap: motto.getBoundingClientRect().right < cta.getBoundingClientRect().x };
      });
      assert.equal(banner.title, 'Tomorrow Now');
      assert.equal(banner.motto, 'Software that powers what’s next.');
      assert.ok(banner.height >= 70 && banner.titleSize >= 19 && banner.mottoSize >= 12);
      assert.ok(banner.visible && banner.noOverlap, `Banner fits at ${width}px`);
      assert.ok(banner.contrast >= 4.5, `Banner text contrast is at least 4.5:1 (${banner.contrast})`);
      if (process.env.QA_BANNER_SCREENSHOT) await page.locator('#tomorrow-now-banner')
        .screenshot({ path: process.env.QA_BANNER_SCREENSHOT.replace(/\.png$/, `-${width}.png`) });
    }
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
    console.log('QA: Tomorrow Now banner and English motto readable at 1000, 1280 and 1600px.');
    await page.locator('#pdf-file-input').setInputFiles(source);
    console.log('QA: input selected');
    await page.waitForFunction(() => document.querySelector('#page-indicator').textContent.includes('25'), { timeout: 30000 });
    await page.locator('#edit-mode').click();
    await page.locator('.text-box').first().waitFor();
    await page.locator('.text-box').first().click();
    await page.locator('#selected-text').fill('DATA 06/09/2026 àèéìòù €');
    await page.locator('#selected-font').fill('Liberation Sans');
    await page.getByRole('option', { name: 'Liberation Sans', exact: true }).click();
    await page.locator('#apply-edit').click();
    console.log('QA: edit submitted');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Ora puoi salvare'));
    await page.locator('.text-box[title="DATA 06/09/2026 àèéìòù €"]').waitFor();
    await page.locator('#pdf-render').click({ position: { x: 260, y: 260 } });
    await page.locator('.inline-text-editor .inline-text-content').fill('TESTO DIRETTO 6');
    await page.locator('#page-indicator').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Testo aggiunto'));
    await page.locator('#select-object-mode.is-active').waitFor();
    await page.locator('.text-box.is-added-object[title="TESTO DIRETTO 6"]').waitFor();
    await page.locator('.inline-text-editor .inline-text-content').waitFor();
    console.log('QA: direct inline text committed without Add Text or Apply');
    await page.locator('#select-object-mode').click();
    await page.locator('#select-object-mode.is-active').waitFor();
    const directTextBox = page.locator('.text-box.is-added-object[title="TESTO DIRETTO 6"]');
    const beforeMove = await directTextBox.boundingBox();
    if (!beforeMove) throw new Error('Direct text box has no bounds');
    await page.mouse.move(beforeMove.x + beforeMove.width / 2, beforeMove.y + beforeMove.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeMove.x + beforeMove.width / 2 + 48, beforeMove.y + beforeMove.height / 2 + 28, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Testo spostato'));
    await page.locator('#select-object-mode.is-active').waitFor();
    await page.locator('.text-box.is-added-object[title="TESTO DIRETTO 6"]').waitFor();
    await page.locator('.inline-text-editor .inline-text-content').waitFor();
    await page.locator('.inline-text-editor .inline-text-content').fill('TESTO RIPRESO 6');
    await page.locator('#apply-edit').click();
    await page.locator('.text-box.is-added-object[title="TESTO RIPRESO 6"]').waitFor();
    await page.locator('#select-object-mode.is-active').waitFor();
    console.log('QA: inserted text reselected, moved and edited without changing tool');
    const fitZoom = Number(await page.locator('#zoom-input').inputValue());
    await page.locator('#zoom-in').click();
    await page.waitForFunction((previous) => Number(document.querySelector('#zoom-input').value) > previous, fitZoom);
    await page.locator('#zoom-input').fill('80');
    await page.locator('#zoom-input').press('Enter');
    await page.waitForFunction(() => document.querySelector('#zoom-input').value === '80');
    await page.locator('#zoom-fit').click();
    await page.locator('#zoom-fit.is-active').waitFor();
    console.log('QA: zoom buttons, editable percentage and fit mode work');
    await page.screenshot({ path: process.env.QA_SCREENSHOT || path.join(temp, 'edited.png') });
    await page.locator('.thumbnail-button[data-page-number="25"]').click();
    await page.waitForFunction(() => document.querySelector('#page-indicator').textContent.startsWith('25'));
    const thumbnailCount = await page.locator('.thumbnail-button canvas').evaluateAll((items) => items.filter((canvas) => canvas.width > 1).length);
    assert.ok(thumbnailCount <= 20, 'At most 20 thumbnails should be retained');
    // Missing-password flow must use the application dialog, never window.prompt.
    await page.locator('#insert-pdf-input').setInputFiles(locked);
    await page.locator('#unlock-dialog[open]').waitFor();
    await page.locator('#unlock-password').fill('test-password');
    await page.locator('#unlock-form button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#page-indicator').textContent.includes('50'));
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('pagine inserite'));
    await page.locator('#unlock-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => 'getBackendToken' in window.desktopAPI), false);
    const rejected = await page.evaluate(async (unauthorizedPath) => {
      try { await window.desktopAPI.readFile(unauthorizedPath); return false; } catch { return true; }
    }, path.join(temp, 'not-authorized.pdf'));
    assert.equal(rejected, true);
    await page.locator('#pdf-file-input').setInputFiles(scanned);
    await page.waitForFunction(() => document.querySelector('#page-indicator').textContent === '1 / 1' && document.querySelector('#status').textContent.includes('PDF caricato'));
    await page.locator('#edit-mode').click();
    // The real OCR subprocess has a 20s deadline (Windows includes a cold
    // PowerShell/WinRT startup). Do not expire the UI assertion at 15s first.
    await page.locator('.text-box[title="SCANSIONE 05/08/2026"]').waitFor({ timeout: 30000 });
    await page.locator('.text-box[title="SCANSIONE 05/08/2026"]').click();
    assert.equal(await page.locator('#selected-font').inputValue(), '');
    assert.equal(await page.locator('#scan-font-notice').isVisible(), true);
    assert.equal(await page.locator('#apply-edit').isDisabled(), true);
    assert.equal(await page.locator('.inline-text-editor').count(), 0);
    if (process.env.QA_SCAN_WARNING_SCREENSHOT) await page.screenshot({ path: process.env.QA_SCAN_WARNING_SCREENSHOT });
    await page.locator('#selected-text').fill('SCANSIONE 06/08/2026');
    assert.equal(await page.locator('#selected-size').isDisabled(), true);
    assert.equal(await page.locator('#apply-edit').isDisabled(), false);
    await page.locator('#apply-edit').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('cifre corrette'));
    await page.locator('.text-box[title="SCANSIONE 06/08/2026"]').click();
    assert.equal(await page.locator('#selected-font').inputValue(), '');
    assert.equal(await page.locator('.inline-text-editor').count(), 0);
    console.log('QA: scanned date corrected without selecting a substitute font.');
    const fonts = await page.evaluate(() => window.desktopAPI.request('/fonts'));
    const chosenFont = fonts.fonts.some(font => font.label === 'Comic Sans MS') ? 'Comic Sans MS' : 'Liberation Sans';
    await page.locator('#selected-font').click();
    await page.getByRole('option', { name: chosenFont, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.inline-text-content')?.style.fontFamily.includes('MacPdf-'));
    assert.equal(await page.locator('.inline-text-content').textContent(), 'SCANSIONE 06/08/2026');
    assert.equal(await page.locator('#apply-edit').isDisabled(), false);
    await page.locator('#apply-edit').click();
    await page.locator('.text-box[title="SCANSIONE 06/08/2026"]').waitFor();
    await page.locator('.text-box[title="SCANSIONE 06/08/2026"]').click();
    assert.equal(await page.locator('#selected-font').inputValue(), chosenFont);
    assert.equal(await page.locator('#scan-font-notice').isVisible(), false);
    await page.waitForFunction(() => document.querySelector('.inline-text-content')?.style.fontFamily.includes('MacPdf-'));
    if (process.env.QA_SCAN_SCREENSHOT) await page.screenshot({ path: process.env.QA_SCAN_SCREENSHOT });
    console.log('QA: scanned font is unknown, explicit font choice uses the exact preview and survives reselection.');
    await page.locator('#pdf-file-input').setInputFiles(unknownFont);
    await page.waitForFunction(() => document.querySelector('#page-indicator').textContent === '1 / 2'
      && document.querySelector('#status').textContent.includes('PDF caricato'));
    await page.locator('#edit-mode').click();
    // Simulate a late frame without delaying PDF.js or Playwright's own frames.
    // A deferred editor focus must never steal the user's sidebar focus.
    await page.evaluate(() => {
      window.__qaOriginalFrame = window.requestAnimationFrame;
      window.__qaEditorFrames = [];
      window.requestAnimationFrame = callback => String(callback).includes('content.focus()')
        ? (window.__qaEditorFrames.push(callback), 999999)
        : window.__qaOriginalFrame(callback);
    });
    await page.locator('.text-box[title="05/08/2026"]').click();
    await page.locator('#selected-text').fill('06/08/2026');
    await page.evaluate(() => {
      window.requestAnimationFrame = window.__qaOriginalFrame;
      const callbacks = window.__qaEditorFrames;
      delete window.__qaOriginalFrame; delete window.__qaEditorFrames;
      callbacks.forEach(callback => callback(performance.now()));
    });
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'selected-text',
      'A late editor callback must not steal sidebar focus and redirect typing');
    assert.equal(await page.locator('.inline-text-content').textContent(), '06/08/2026');
    await page.locator('#apply-edit').click();
    await page.locator('#font-consent-dialog[open]').waitFor();
    assert.match(await page.locator('#font-consent-list').textContent(), /AuditEmbedded-Bold.*Liberation Sans Bold/);
    if (process.env.QA_FONT_CONSENT_SCREENSHOT) await page.screenshot({ path: process.env.QA_FONT_CONSENT_SCREENSHOT });
    await page.getByRole('button', { name: 'Mantieni originale', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('annullato'));
    assert.equal(await page.locator('#undo-action').isDisabled(), true);
    await page.locator('.text-box[title="05/08/2026"]').waitFor();
    await page.locator('#apply-edit').click();
    await page.locator('#font-consent-dialog[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('annullato'));
    assert.equal(await page.locator('#undo-action').isDisabled(), true);
    await page.locator('#apply-edit').click();
    await page.locator('#font-consent-dialog[open]').waitFor();
    await page.locator('#confirm-font-substitution').click();
    await page.locator('.text-box[title="06/08/2026"]').waitFor();
    assert.equal(await page.locator('#undo-action').isDisabled(), false);
    await page.locator('#pdf-file-input').setInputFiles(unknownFont);
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('PDF caricato'));
    await page.locator('#edit-mode').click();
    await page.locator('.text-box[title="05/08/2026"]').click();
    await page.locator('#selected-text').fill('06/08/2026');
    await page.locator('#coherent-edit').click();
    await page.locator('#coherent-dialog[open]').waitFor();
    assert.equal(await page.locator('#coherent-new-text').textContent(), '06/08/2026');
    await page.locator('#apply-coherent-edit').click();
    await page.locator('#font-consent-dialog[open]').waitFor();
    await page.getByRole('button', { name: 'Mantieni originale', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Sostituzioni annullate'));
    assert.equal(await page.locator('#coherent-dialog').isVisible(), true);
    assert.equal(await page.locator('#undo-action').isDisabled(), true);
    await page.locator('#apply-coherent-edit').click();
    await page.locator('#font-consent-dialog[open]').waitFor();
    await page.locator('#confirm-font-substitution').click();
    await page.locator('#coherent-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('2 occorrenze aggiornate')
      && document.querySelector('#status').textContent.includes('il vecchio valore non è più presente'));
    await page.locator('.text-box[title="06/08/2026"]').waitFor();
    await page.locator('.thumbnail-button[data-page-number="2"]').click();
    await page.locator('.text-box[title="06/08/2026"]').waitFor();
    console.log('QA: font substitution names, cancellation, Escape, single and atomic batch consent verified.');
    assert.deepEqual(errors, []);
    console.log('Electron UI QA OK: open, edit, font preview, page 25, bounded thumbnails, password-protected insertion, IPC boundary.');
  } catch (error) {
    console.log('QA status:', await page.locator('#status').textContent());
    console.log('QA synthetic overlay snapshot:', JSON.stringify(await page.evaluate(() => ({
      page: document.querySelector('#page-indicator')?.textContent,
      editButton: document.querySelector('#edit-mode')?.className,
      objectButton: document.querySelector('#select-object-mode')?.className,
      boxes: [...document.querySelectorAll('.text-box')].map(box => ({ title: box.title,
        width: box.getBoundingClientRect().width, height: box.getBoundingClientRect().height,
        display: getComputedStyle(box).display })),
    }))));
    // This isolated profile only processes the generated fixtures above.
    const backendLog = path.join(temp, 'profile/logs/backend.log');
    if (fs.existsSync(backendLog)) console.log('QA backend diagnostics:', fs.readFileSync(backendLog, 'utf8').slice(-8000));
    const diagnosticsDirectory = process.env.QA_DIAGNOSTICS_DIRECTORY || os.tmpdir();
    fs.mkdirSync(diagnosticsDirectory, { recursive: true });
    await page.screenshot({ path: path.join(diagnosticsDirectory, 'pdf-security-ui-failure.png') });
    throw error;
  } finally {
    console.log('QA: closing Electron');
    const child = application.process();
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    try { await application.close(); } finally { clearTimeout(timer); }
    const sessions = path.join(temp, 'profile/pdf-sessions');
    assert.ok(!fs.existsSync(sessions) || fs.readdirSync(sessions).length === 0, 'Session copies removed at shutdown');
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
