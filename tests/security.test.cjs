const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { FileAccess, BackendSession, MAX_PDF_BYTES } = require('../desktop-security');
const root = path.resolve(__dirname, '..');

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

test('Actual backend: private pipe, ephemeral port, auth, fonts, passwords, round trip and cleanup', { timeout: 80000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-session-test-'));
  // Occupy the old fixed port when available: the app must not connect to it.
  let contacted = false;
  const decoy = net.createServer((socket) => { contacted = true; socket.end(); });
  await new Promise((resolve) => { decoy.once('error', resolve); decoy.listen(8000, '127.0.0.1', resolve); });
  let session;
  try {
    execFileSync(path.join(root, '.build-venv/bin/python'), ['-c',
      'import fitz,sys; from pathlib import Path; p=Path(sys.argv[1]); d=fitz.open(); page=d.new_page(); page.insert_text((72,72),"05/08/2026"); d.save(p/"source.pdf"); d.save(p/"locked.pdf", encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner-test", user_pw="secret-test"); d.close()', temp]);
    const packaged = process.env.QA_BACKEND_EXECUTABLE;
    session = new BackendSession({ executable: packaged || path.join(root, '.build-venv/bin/python'),
      args: packaged ? [] : [path.join(root, 'backend/main.py')], cwd: root,
      fonts: process.env.QA_FONTS_DIRECTORY || path.join(root, 'assets/fonts'), tempRoot: temp, log: () => {} });
    await session.ready;
    assert.notEqual(new URL(session.base).port, '8000');
    assert.equal((await session.request('/health')).session_id, session.id);
    assert.equal(contacted, false);
    assert.equal((await fetch(session.base + '/health')).status, 401);
    assert.equal((await fetch(session.base + '/health', { headers: { Authorization: 'Bearer é' } })).status, 401);
    assert.equal((await session.request('/fonts')).fonts.length, 20);
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
    assert.equal(path.dirname(unlocked.output_path), session.directory);
    assert.equal((await session.request('/pdf-info', { file_path: unlocked.output_path })).needs_password, false);
    await assert.rejects(session.request('/insert-pdf', { file_path: source, insert_file_path: locked, insert_at: 1 }), /password/);
    const merged = await session.request('/insert-pdf', { file_path: source, insert_file_path: locked, insert_at: 1, insert_password: 'secret-test' });
    assert.equal(merged.page_count, 2);
    const added = await session.request('/add-text', { file_path: source, new_text: '06/09/2026 àèéìòù €', origin: [72, 130], font: 'FranklinGothic-Book', size: 12 });
    const spans = (await session.request('/inspect-text', { file_path: added.output_path, page_num: 0 })).spans;
    assert.ok(spans.some((span) => span.text.includes('06/09/2026 àèéìòù €')));
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

test('Abandoned session cleanup never touches unrelated or live directories', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-cleanup-'));
  try {
    for (const name of ['session-stale', 'session-live', 'unrelated']) fs.mkdirSync(path.join(temp, name));
    fs.writeFileSync(path.join(temp, 'session-stale/owner.json'), JSON.stringify({ pid: 2147483647 }));
    fs.writeFileSync(path.join(temp, 'session-live/owner.json'), JSON.stringify({ pid: process.pid }));
    BackendSession.cleanAbandoned(temp);
    assert.equal(fs.existsSync(path.join(temp, 'session-stale')), false);
    assert.equal(fs.existsSync(path.join(temp, 'session-live')), true);
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
