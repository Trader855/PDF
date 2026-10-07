const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { FileAccess, BackendSession, MAX_PDF_BYTES, isDirectChild } = require('../desktop-security');
const { virtualEnvironmentPython } = require('../platform-runtime');
const root = path.resolve(__dirname, '..');
const python = virtualEnvironmentPython(root);

test('File capabilities: unauthorized paths, symlinks, replacement, size and one-shot save', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-security-'));
  try {
    const source = path.join(temp, 'source.pdf');
    const other = path.join(temp, 'other.pdf');
    fs.writeFileSync(source, '%PDF-1.7\nsource'); fs.writeFileSync(other, '%PDF-1.7\nother');
    const access = new FileAccess(temp);
    assert.throws(() => access.read(source), /non autorizzato/);
    access.register(source);
    assert.match(access.read(source).toString(), /source/);
    const alias = path.join(temp, 'alias.pdf'); fs.symlinkSync(source, alias);
    assert.throws(() => access.register(alias), /collegamento/);
    const large = path.join(temp, 'large.pdf');
    fs.writeFileSync(large, ''); fs.truncateSync(large, MAX_PDF_BYTES + 1);
    assert.throws(() => access.register(large), /100 MB/);
    assert.throws(() => access.save(source, other), /destinazione/);
    const target = access.allowSave(other); access.save(source, target);
    assert.equal(fs.readFileSync(other, 'utf8'), '%PDF-1.7\nsource');
    assert.throws(() => access.save(source, target), /destinazione/);
    const changedTarget = access.allowSave(other); fs.unlinkSync(other); fs.symlinkSync(source, other);
    assert.throws(() => access.save(source, changedTarget), /cambiata/);
    fs.renameSync(source, path.join(temp, 'original.pdf')); fs.writeFileSync(source, 'replacement');
    assert.throws(() => access.read(source), /sostituito/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Backend outputs must be direct children of the private session', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-session-child-check-'));
  const session = path.join(temp, 'session');
  const nested = path.join(session, 'nested');
  fs.mkdirSync(nested, { recursive: true });
  try {
    assert.equal(isDirectChild(session, path.join(session, 'result.pdf')), true);
    assert.equal(isDirectChild(session, path.join(nested, 'result.pdf')), false);
    assert.equal(isDirectChild(session, path.join(temp, 'outside.pdf')), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Actual backend: private pipe, ephemeral port, auth, fonts, passwords, round trip and cleanup', { timeout: 80000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-session-test-'));
  // Occupy the old fixed port when available: the app must not connect to it.
  let contacted = false;
  const decoy = net.createServer((socket) => { contacted = true; socket.end(); });
  await new Promise((resolve) => { decoy.once('error', resolve); decoy.listen(8000, '127.0.0.1', resolve); });
  let session;
  try {
    execFileSync(python, ['-c',
      'import fitz,sys; from pathlib import Path; p=Path(sys.argv[1]); d=fitz.open(); page=d.new_page(); page.insert_text((72,72),"05/08/2026"); d.save(p/"source.pdf"); d.save(p/"locked.pdf", encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner-test", user_pw="secret-test"); d.close()', temp]);
    const packaged = process.env.QA_BACKEND_EXECUTABLE;
    session = new BackendSession({ executable: packaged || python,
      args: packaged ? [] : [path.join(root, 'backend/main.py')], cwd: root,
      fonts: process.env.QA_FONTS_DIRECTORY || path.join(root, 'assets/fonts'), tempRoot: temp, log: () => {} });
    await session.ready;
    assert.notEqual(new URL(session.base).port, '8000');
    assert.equal((await session.request('/health')).session_id, session.id);
    assert.equal(contacted, false);
    assert.equal((await fetch(session.base + '/health')).status, 401);
    assert.equal((await fetch(session.base + '/health', { method: 'OPTIONS' })).status, 401);
    assert.equal((await fetch(session.base + '/health', { headers: { Authorization: 'Bearer é' } })).status, 401);
    assert.equal((await session.request('/fonts')).fonts.filter(font => font.source === 'bundled').length, 20);
    const fonts = await session.request('/fonts');
    assert.ok((await session.request(`/font-file/${fonts.fonts[0].id}`)).length > 1000);
    const source = session.files.register(path.join(temp, 'source.pdf'));
    const locked = session.files.register(path.join(temp, 'locked.pdf'));
    assert.equal((await session.request('/pdf-info', { file_path: locked })).needs_password, true);
    await assert.rejects(session.request('/pdf-info', { file_path: '/etc/secret.pdf' }));
    await assert.rejects(session.request('/add-text', { file_path: source, output_path: source }), /destinazioni esterne/);
    assert.equal((await fetch(session.base + '/add-text', { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ file_path: source, output_path: source }) })).status, 403);
    await assert.rejects(session.request('/unlock-pdf', { file_path: locked, password: 'wrong' }), /Password/);
    const unlocked = await session.request('/unlock-pdf', { file_path: locked, password: 'secret-test' });
    assert.equal(isDirectChild(session.directory, unlocked.output_path), true);
    assert.equal((await session.request('/pdf-info', { file_path: unlocked.output_path })).needs_password, false);
    await assert.rejects(session.request('/insert-pdf', { file_path: source, insert_file_path: locked, insert_at: 1 }), /password/);
    const merged = await session.request('/insert-pdf', { file_path: source, insert_file_path: locked, insert_at: 1, insert_password: 'secret-test' });
    assert.equal(merged.page_count, 2);
    const added = await session.request('/add-text', { file_path: source, new_text: '06/09/2026 àèéìòù €', origin: [72, 130], font: 'FranklinGothic-Book', size: 12 });
    const spans = (await session.request('/inspect-text', { file_path: added.output_path, page_num: 0 })).spans;
    assert.ok(spans.some((span) => span.text.includes('06/09/2026 àèéìòù €')));
    if (process.env.QA_REQUIRE_SCAN_STYLE === '1') {
      execFileSync(python, ['-c',
        'import fitz,sys; d=fitz.open(); p=d.new_page(width=595,height=400); p.insert_text((72,140),"SCANSIONE 05/08/2026",fontsize=32); png=p.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False).tobytes("png"); d.close(); d=fitz.open(); p=d.new_page(width=595,height=400); p.insert_image(p.rect,stream=png); d.save(sys.argv[1]); d.close()', path.join(temp, 'scan.pdf')]);
      const scan = session.files.register(path.join(temp, 'scan.pdf'));
      const inspected = await session.request('/inspect-text', { file_path: scan, page_num: 0 });
      const scannedSpan = inspected.spans.find(span => span.text === 'SCANSIONE 05/08/2026');
      assert.ok(scannedSpan, 'Packaged OCR must recognize the synthetic line');
      assert.equal(scannedSpan.source, 'ocr');
      assert.equal(scannedSpan.font_identified, false);
      assert.equal(scannedSpan.font, '');
      assert.equal(scannedSpan.background_color, 0xFFFFFF);
      const edit = { ...scannedSpan, file_path: scan, page_num: 0, new_text: 'SCANSIONE 06/08/2026', font: 'Liberation Sans', background_color: 0xF0F0F0 };
      await assert.rejects(session.request('/edit-text', edit), /scansione/);
      const preserved = await session.request('/edit-text', { ...edit, original_text: scannedSpan.text, preserve_scan_digits: true });
      assert.equal(preserved.edit_mode, 'scan_digits');
      assert.equal(preserved.changed_digits, 1);
      const preservedSpans = (await session.request('/inspect-text', { file_path: preserved.output_path, page_num: 0 })).spans;
      assert.ok(preservedSpans.some(span => span.text === edit.new_text && span.source === 'ocr'));
      assert.ok(!preservedSpans.some(span => span.source === 'native'));
      const changed = await session.request('/edit-text', { ...edit, confirm_font_substitution: true });
      assert.equal(changed.font_used, 'Liberation Sans');
      assert.ok(changed.size_used >= 5);
      const native = (await session.request('/inspect-text', { file_path: changed.output_path, page_num: 0 })).spans;
      assert.ok(native.some(span => span.text === edit.new_text && span.source !== 'ocr'));
      execFileSync(python, ['-c', 'import fitz,sys; d=fitz.open(sys.argv[1]); fills=[item["fill"] for item in d[0].get_drawings() if item["fill"]]; assert (1.0,1.0,1.0) in fills, fills; assert (240/255,240/255,240/255) not in fills; d.close()', changed.output_path]);
    }
    session.prune([source, added.output_path]);
    assert.equal(fs.existsSync(unlocked.output_path), false);
    assert.equal(fs.existsSync(merged.output_path), false);
    const directory = session.directory;
    // Simulate a crashed parent closing its only pipe, without sending a signal.
    session.process.stdin.end();
    let timer;
    try {
      await Promise.race([session.closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Backend did not exit on parent EOF')), 5000); })]);
    } finally { clearTimeout(timer); }
    assert.equal(fs.existsSync(directory), false);
    assert.equal(fs.existsSync(source), true);
  } finally {
    if (session) await session.stop();
    if (decoy.listening) await new Promise((resolve) => decoy.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Font consent crosses IPC without granting an output until confirmation', { timeout: 30000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-font-consent-ipc-'));
  let session;
  try {
    const hiddenSpan = JSON.parse(execFileSync(python, ['-c',
      'import sys,json; from pathlib import Path; sys.path.insert(0,"tests"); from test_font_edit_safety import FontEditSafetyTests; t=FontEditSafetyTests(); t.root=Path(sys.argv[1]); t.native_fixture(pages=2); _,span,_=t.scan_fixture(); print(json.dumps(span))', temp], { cwd: root, encoding: 'utf8' }));
    const packaged = process.env.QA_BACKEND_EXECUTABLE;
    session = new BackendSession({ executable: packaged || python,
      args: packaged ? [] : [path.join(root, 'backend/main.py')],
      cwd: root, fonts: process.env.QA_FONTS_DIRECTORY || path.join(root, 'assets/fonts'), tempRoot: temp, log: () => {} });
    await session.ready;
    const source = session.files.register(path.join(temp, 'native.pdf'));
    const before = fs.readFileSync(source);
    const span = (await session.request('/inspect-text', { file_path: source, include_ocr: false })).spans[0];
    const change = { ...span, page_num: 0 };
    const edit = { ...change, file_path: source, new_text: '06/08/2026' };
    const conflict = await session.request('/edit-text', edit);
    assert.deepEqual(conflict, { status: 'font_substitution_required', substitutions: [
      { index: 0, requested_font: 'AuditEmbedded-Bold', proposed_font: 'Liberation Sans Bold' },
    ] });
    assert.deepEqual(fs.readFileSync(source), before);
    assert.equal(fs.readdirSync(session.directory).filter(name => name.endsWith('.pdf')).length, 0);
    assert.equal(session.files.allowed.size, 1, 'Conflict must not authorize a new path');
    const batch = await session.request('/batch-edit-text', { file_path: source,
      old_text: span.text, new_text: edit.new_text, changes: [change, { ...change, page_num: 1 }] });
    assert.deepEqual(batch.substitutions.map(item => item.index), [0, 1]);
    assert.equal(fs.readdirSync(session.directory).filter(name => name.endsWith('.pdf')).length, 0);
    const result = await session.request('/edit-text', { ...edit, confirm_font_substitution: true,
      confirmed_substitute_font: conflict.substitutions[0].proposed_font });
    assert.equal(result.font_used, 'Liberation Sans Bold');
    assert.equal(isDirectChild(session.directory, result.output_path), true);
    assert.ok((await session.request('/inspect-text', { file_path: result.output_path })).spans
      .some(item => item.text === edit.new_text));
    const hidden = session.files.register(path.join(temp, 'searchable-scan.pdf'));
    const hiddenInspection = (await session.request('/inspect-text', { file_path: hidden })).spans;
    assert.ok(hiddenInspection.every(item => item.source === 'ocr'), 'Hidden OCR must never be exposed as native');
    if (process.env.QA_REQUIRE_SCAN_STYLE === '1') {
      assert.ok(hiddenInspection.some(item => item.text === hiddenSpan.text && item.font === ''),
        'The compiled OCR helper must inspect the visible scan, without claiming an original font');
    }
    const outputsBefore = fs.readdirSync(session.directory).filter(name => name.endsWith('.pdf')).sort();
    await assert.rejects(session.request('/edit-text', { ...hiddenSpan, file_path: hidden, new_text: 'DATA 06/08/2026' }), /OCR invisibile/);
    assert.deepEqual(fs.readdirSync(session.directory).filter(name => name.endsWith('.pdf')).sort(), outputsBefore);
  } finally {
    if (session) await session.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Backend environment preserves named OS context but never arbitrary private variables', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-env-boundary-'));
  const worker = path.join(temp, 'synthetic-worker.cjs');
  const previous = Object.fromEntries(['PROCESSOR_LEVEL', 'TN_QA_UNTRUSTED_SECRET'].map(key => [key, process.env[key]]));
  let session;
  try {
    fs.writeFileSync(worker, `const fs = require('fs'); const readline = require('readline');
      readline.createInterface({ input: process.stdin }).once('line', line => {
        const request = JSON.parse(line);
        console.log(JSON.stringify({ system: process.env.PROCESSOR_LEVEL, private: 'TN_QA_UNTRUSTED_SECRET' in process.env }));
        fs.writeSync(3, JSON.stringify({ session_id: request.session_id, port: 12345 }) + '\\n');
      }); process.stdin.on('end', () => process.exit(0));`);
    process.env.PROCESSOR_LEVEL = 'synthetic-system-context';
    process.env.TN_QA_UNTRUSTED_SECRET = 'synthetic-do-not-forward';
    let output = '';
    session = new BackendSession({ executable: process.execPath, args: [worker], cwd: root,
      fonts: path.join(root, 'assets/fonts'), tempRoot: temp, log: chunk => { output += chunk.toString(); } });
    await session.ready;
    await session.stop();
    assert.deepEqual(JSON.parse(output.trim()), { system: 'synthetic-system-context', private: false });
  } finally {
    if (session) await session.stop();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Font conflict transport rejects malformed details and strips unexpected capabilities', async () => {
  const session = Object.assign(Object.create(BackendSession.prototype), {
    pending: 0, queue: Promise.resolve(), ready: Promise.resolve(), stopped: false,
    base: 'http://127.0.0.1:1', token: 'synthetic-test-token',
    files: { require: value => value, registerOutput: () => assert.fail('No output can be granted on conflict') },
  });
  const originalFetch = global.fetch;
  const item = { index: 0, requested_font: '<b>Original</b>', proposed_font: 'Liberation Sans' };
  try {
    global.fetch = async () => ({ ok: false, status: 409, json: async () => ({
      detail: { status: 'font_substitution_required', substitutions: [{ ...item, output_path: '/unexpected' }],
        output_path: '/unexpected' },
    }) });
    assert.deepEqual(await session.request('/edit-text', { file_path: 'synthetic' }), {
      status: 'font_substitution_required', substitutions: [item],
    });
    for (const substitutions of [[], [{ ...item, index: 1 }], [{ ...item, proposed_font: '' }],
      [{ ...item, proposed_font: 'x'.repeat(257) }], [item, item]]) {
      global.fetch = async () => ({ ok: false, status: 409, json: async () => ({
        detail: { status: 'font_substitution_required', substitutions },
      }) });
      await assert.rejects(session.request('/edit-text', { file_path: 'synthetic' }), /409/);
    }
    await assert.rejects(session.request('/add-text', { file_path: 'synthetic' }), /409/);
  } finally { global.fetch = originalFetch; }
});

test('Abandoned session cleanup never touches unrelated or live directories', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-cleanup-'));
  try {
    for (const name of ['session-stale', 'session-live', 'session-expired', 'unrelated']) fs.mkdirSync(path.join(temp, name));
    fs.writeFileSync(path.join(temp, 'session-stale/owner.json'), JSON.stringify({ pid: 2147483647 }));
    fs.writeFileSync(path.join(temp, 'session-live/owner.json'), JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
    fs.writeFileSync(path.join(temp, 'session-expired/owner.json'), JSON.stringify({ pid: process.pid, createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000 }));
    BackendSession.cleanAbandoned(temp);
    assert.equal(fs.existsSync(path.join(temp, 'session-stale')), false);
    assert.equal(fs.existsSync(path.join(temp, 'session-live')), true);
    assert.equal(fs.existsSync(path.join(temp, 'session-expired')), false);
    assert.equal(fs.existsSync(path.join(temp, 'unrelated')), true);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Renderer security policy and pinned engines do not regress', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.doesNotMatch(html, /'unsafe-eval'|127\.0\.0\.1/);
  assert.match(renderer, /isEvalSupported: false/);
  assert.doesNotMatch(renderer, /window\.prompt|getBackendToken|fetch\(/);
  assert.doesNotMatch(preload, /getBackendToken|file\?\.path/);
  assert.match(renderer, /IntersectionObserver/);
});

test('Windows beta keeps its updater isolated from the Mac release channel', () => {
  const builder = require('../electron-builder.windows.cjs');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const desktopSecurity = fs.readFileSync(path.join(root, 'desktop-security.js'), 'utf8');
  assert.equal(builder.publish, null);
  assert.equal(builder.fileAssociations[0].name, 'TomorrowNowPDFDocument');
  assert.equal(builder.fileAssociations[0].ext, 'pdf');
  assert.equal(builder.fileAssociations[0].mimeType, 'application/pdf');
  assert.equal(builder.fileAssociations[0].role, 'Editor');
  assert.match(main, /process\.platform === 'win32' \? 'unavailable'/);
  assert.match(desktopSecurity, /windowsHide: process\.platform === 'win32'/);
});

test('Mac release declares itself as an editor for PDF documents', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const associations = packageJson.build.fileAssociations;
  assert.equal(associations.length, 1);
  assert.deepEqual(associations[0], {
    ext: 'pdf',
    name: 'TomorrowNowPDFDocument',
    description: 'Documento PDF',
    mimeType: 'application/pdf',
    role: 'Editor',
  });
  assert.match(packageJson.scripts['qa:release'], /test:packaged-app/);
});

test('Release builds create clean output directories before compiling', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts['prebuild:ocr'], /prepare:build-dirs/);
  assert.match(packageJson.scripts['prebuild:backend'], /prepare:build-dirs/);
  assert.match(packageJson.scripts['prebuild:backend:win'], /prepare:build-dirs/);
  assert.match(
    fs.readFileSync(path.join(root, 'scripts/prepare_build_dirs.cjs'), 'utf8'),
    /\['dist', 'release'\]/,
  );
});
