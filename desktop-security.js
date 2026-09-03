// Security boundary: renderer code never receives the backend credential.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const POST_ENDPOINTS = new Set([
  '/pdf-info', '/inspect-text', '/search-text', '/unlock-pdf', '/reorder-pages',
  '/insert-pdf', '/add-text', '/edit-text', '/batch-edit-text', '/find-repeated-text',
  '/add-image', '/page-operation', '/add-annotation', '/inspect-forms',
  '/create-form-field', '/fill-forms', '/compress-pdf', '/ocr-pdf',
]);

function checkedPdf(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.pdf') {
    throw new Error('Percorso PDF non valido');
  }
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PDF_BYTES) {
    throw new Error('Seleziona un PDF regolare fino a 100 MB, non un collegamento');
  }
  return fs.realpathSync(filePath);
}

class FileAccess {
  constructor(sessionDirectory) {
    this.sessionDirectory = fs.realpathSync(sessionDirectory);
    this.allowed = new Map();
    this.saveTarget = null;
  }
  register(filePath) {
    const canonical = checkedPdf(filePath);
    const stat = fs.statSync(canonical);
    this.allowed.set(canonical, { dev: stat.dev, ino: stat.ino });
    return canonical;
  }
  require(filePath) {
    const canonical = checkedPdf(filePath);
    const entry = this.allowed.get(canonical);
    const stat = fs.statSync(canonical);
    if (!entry || stat.dev !== entry.dev || stat.ino !== entry.ino) throw new Error('File non autorizzato o sostituito: riaprilo');
    return canonical;
  }
  registerOutput(filePath) {
    const canonical = checkedPdf(filePath);
    if (path.dirname(canonical) !== this.sessionDirectory) throw new Error('Risposta del backend non valida');
    return this.register(canonical);
  }
  read(filePath) {
    const canonical = this.require(filePath);
    const fd = fs.openSync(canonical, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      const entry = this.allowed.get(canonical);
      if (!stat.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino || stat.size > MAX_PDF_BYTES) throw new Error('File sostituito');
      return fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  }
  allowSave(filePath) {
    if (!filePath) { this.saveTarget = null; return null; }
    if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.pdf') throw new Error('Destinazione PDF non valida');
    const canonical = path.join(fs.realpathSync(path.dirname(filePath)), path.basename(filePath));
    const stat = fs.existsSync(canonical) ? fs.lstatSync(canonical) : null;
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Destinazione non valida');
    this.saveTarget = { path: canonical, dev: stat?.dev, ino: stat?.ino };
    return canonical;
  }
  save(source, destination) {
    const target = this.saveTarget;
    this.saveTarget = null; // Every native dialog authorizes exactly one save.
    if (!target || target.path !== destination) throw new Error('Scegli prima la destinazione con Salva PDF');
    const bytes = this.read(source);
    const stat = fs.existsSync(destination) ? fs.lstatSync(destination) : null;
    if (stat?.dev !== target.dev || stat?.ino !== target.ino || stat?.isSymbolicLink()) throw new Error('Destinazione cambiata: ripeti il salvataggio');
    const temporary = path.join(path.dirname(destination), `.pdf-save-${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      // rename replaces the directory entry, never follows a destination symlink.
      fs.renameSync(temporary, destination);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
}

class BackendSession {
  static cleanAbandoned(tempRoot) {
    for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^session-[a-zA-Z0-9]+$/.test(entry.name)) continue;
      const directory = path.join(tempRoot, entry.name);
      try {
        const owner = JSON.parse(fs.readFileSync(path.join(directory, 'owner.json'), 'utf8'));
        if (!Number.isInteger(owner.pid) || owner.pid < 1) continue;
        try { process.kill(owner.pid, 0); continue; } catch (error) { if (error.code !== 'ESRCH') continue; }
        fs.rmSync(directory, { recursive: true, force: true });
      } catch { /* Never delete an unrecognized directory. */ }
    }
  }
  constructor({ executable, args, cwd, fonts, tempRoot, log }) {
    this.directory = fs.realpathSync(fs.mkdtempSync(path.join(tempRoot, 'session-')));
    fs.chmodSync(this.directory, 0o700);
    fs.writeFileSync(path.join(this.directory, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    this.files = new FileAccess(this.directory);
    this.token = crypto.randomBytes(32).toString('hex');
    this.id = crypto.randomUUID();
    this.stopped = false;
    this.pending = 0;
    this.queue = Promise.resolve();
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE']
      .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
    env.PYTHONUNBUFFERED = '1';
    env.MAC_PDF_EDITOR_FONTS_DIR = fonts;
    this.process = spawn(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    this.process.stdout.on('data', log);
    this.process.stderr.on('data', log);
    this.process.stdin.on('error', () => {});
    this.process.stdin.write(JSON.stringify({ token: this.token, session_id: this.id, directory: this.directory }) + '\n');
    this.closed = new Promise((resolve) => this.process.once('close', () => { this.stopped = true; resolve(); }));
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Avvio backend scaduto')); this.stop(); }, 40000);
      let message = '';
      const fail = () => { clearTimeout(timer); reject(new Error('Backend locale non disponibile')); };
      this.process.once('error', fail);
      this.process.once('exit', fail);
      this.process.stdio[3].on('data', (chunk) => {
        message += chunk.toString();
        if (message.length > 4096) { fail(); this.stop(); return; }
        if (!message.includes('\n')) return;
        try {
          const ready = JSON.parse(message.trim());
          if (ready.session_id !== this.id || !Number.isInteger(ready.port) || ready.port < 1 || ready.port > 65535) throw new Error();
          this.base = `http://127.0.0.1:${ready.port}`;
          clearTimeout(timer);
          resolve();
        } catch { fail(); this.stop(); }
      });
    });
    this.ready.catch(() => {});
  }
  prune(keepPaths) {
    if (!Array.isArray(keepPaths) || keepPaths.length > 100) throw new Error('Sessione non valida');
    const keep = new Set(keepPaths.map((filePath) => this.files.require(filePath)));
    for (const entry of fs.readdirSync(this.directory)) {
      if (!entry.endsWith('.pdf')) continue;
      const filePath = path.join(this.directory, entry);
      if (!keep.has(filePath)) fs.unlinkSync(filePath);
    }
    for (const filePath of this.files.allowed.keys()) if (!keep.has(filePath)) this.files.allowed.delete(filePath);
  }
  async request(endpoint, body = null) {
    if (this.pending >= 20) throw new Error('Troppe operazioni: attendi il completamento');
    if (!POST_ENDPOINTS.has(endpoint) && endpoint !== '/health' && endpoint !== '/fonts' && !/^\/font-file\/[a-z0-9_-]+$/.test(endpoint)) throw new Error('Operazione non consentita');
    const payload = body == null ? null : JSON.parse(JSON.stringify(body));
    if (POST_ENDPOINTS.has(endpoint)) {
      if (!payload || typeof payload !== 'object') throw new Error('Richiesta non valida');
      payload.file_path = this.files.require(payload.file_path);
      if (payload.insert_file_path) payload.insert_file_path = this.files.require(payload.insert_file_path);
      if (payload.output_path != null) throw new Error('Il backend non può scegliere destinazioni esterne');
      if (JSON.stringify(payload).length > 36 * 1024 * 1024) throw new Error('Richiesta troppo grande');
    }
    this.pending++;
    const operation = this.queue.then(async () => {
      await this.ready;
      if (this.stopped) throw new Error('Sessione terminata: riavvia l’app');
      try {
        const response = await fetch(this.base + endpoint, {
          method: POST_ENDPOINTS.has(endpoint) ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: payload == null ? undefined : JSON.stringify(payload),
          redirect: 'error', signal: AbortSignal.timeout(120000),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(typeof error.detail === 'string' ? error.detail : `Operazione non riuscita (${response.status})`);
        }
        if (endpoint.startsWith('/font-file/')) return new Uint8Array(await response.arrayBuffer());
        const result = await response.json();
        if (endpoint === '/health' && result.session_id !== this.id) throw new Error('Identità backend non valida');
        if (result.output_path) this.files.registerOutput(result.output_path);
        return result;
      } catch (error) {
        if (error.name === 'TimeoutError') { await this.stop(); throw new Error('Operazione troppo lunga. Sessione arrestata; riavvia l’app.'); }
        throw error;
      }
    });
    this.queue = operation.catch(() => {}).finally(() => { this.pending--; });
    return operation;
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopped = true;
    this.stopPromise = (async () => {
      this.process.stdin.end();
      this.process.kill('SIGTERM');
      const timer = setTimeout(() => this.process.kill('SIGKILL'), 4000);
      await this.closed;
      clearTimeout(timer);
      fs.rmSync(this.directory, { recursive: true, force: true });
    })();
    return this.stopPromise;
  }
}

module.exports = { BackendSession, FileAccess, MAX_PDF_BYTES };
