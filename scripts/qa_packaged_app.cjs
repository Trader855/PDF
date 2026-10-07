const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const plistPath = path.join(
  projectRoot,
  'release',
  'mac-arm64',
  'Mac PDF Editor.app',
  'Contents',
  'Info.plist',
);

if (process.platform !== 'darwin') {
  console.log('Controllo Info.plist ignorato: viene eseguito soltanto nella build macOS.');
  process.exit(0);
}

assert.ok(
  fs.existsSync(plistPath) && fs.statSync(plistPath).isFile(),
  `Info.plist non trovato: ${plistPath}`,
);

function readPlistValue(key, format = 'json') {
  return execFileSync('/usr/bin/plutil', ['-extract', key, format, '-o', '-', plistPath], {
    encoding: 'utf8',
  });
}

const documentTypes = JSON.parse(readPlistValue('CFBundleDocumentTypes'));
const pdfType = documentTypes.find((entry) => (
  Array.isArray(entry.CFBundleTypeExtensions)
  && entry.CFBundleTypeExtensions.some((extension) => extension.toLowerCase() === 'pdf')
));

assert.ok(pdfType, 'Il pacchetto non dichiara l’estensione PDF in CFBundleDocumentTypes.');
assert.equal(pdfType.CFBundleTypeRole, 'Editor');
assert.equal(pdfType.CFBundleTypeName, 'TomorrowNowPDFDocument');

const version = readPlistValue('CFBundleShortVersionString', 'raw').trim();
assert.equal(version, packageJson.version);

const minimumSystemVersion = readPlistValue('LSMinimumSystemVersion', 'raw').trim();
const numericVersion = value => value.split('.').map(Number).reduce((result, part, index) => result + part / 100 ** index, 0);
for (const executable of ['mac-pdf-backend', 'mac-pdf-ocr']) {
  const binary = path.join(path.dirname(plistPath), 'Resources', 'backend', executable);
  const commands = execFileSync('/usr/bin/otool', ['-l', binary], { encoding: 'utf8' });
  const minimum = commands.match(/\bminos\s+([\d.]+)/)?.[1]
    || commands.match(/LC_VERSION_MIN_MACOSX\s+cmdsize\s+\d+\s+version\s+([\d.]+)/)?.[1];
  assert.ok(minimum, `Minimum macOS version missing from ${executable}`);
  assert.ok(numericVersion(minimum) <= numericVersion(minimumSystemVersion),
    `${executable} requires macOS ${minimum}, but the app declares ${minimumSystemVersion}`);
}

console.log(
  `Pacchetto ${version} verificato: macOS lo registra come Editor per i documenti PDF.`,
);
