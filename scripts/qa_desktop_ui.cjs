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
  execFileSync(virtualEnvironmentPython(root), ['-c',
    'import fitz,sys; from pathlib import Path; p=Path(sys.argv[1]); d=fitz.open(); [(d.new_page().insert_text((72,72),"DATA 05/08/2026 PAGINA %d"%i)) for i in range(1,26)]; d.save(p/"relazione finale.pdf"); d.save(p/"allegato protetto.pdf",encryption=fitz.PDF_ENCRYPT_AES_256,owner_pw="owner",user_pw="test-password"); d.close()', documents]);
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
    assert.deepEqual(errors, []);
    console.log('Electron UI QA OK: open, edit, font preview, page 25, bounded thumbnails, password-protected insertion, IPC boundary.');
  } catch (error) {
    console.log('QA status:', await page.locator('#status').textContent());
    await page.screenshot({ path: path.join(os.tmpdir(), 'pdf-security-ui-failure.png') });
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
