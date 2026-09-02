const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));
const dmgPath = path.join(projectRoot, 'release', `Mac-PDF-Editor-${packageJson.version}-arm64.dmg`);
const updateMetadataPath = path.join(projectRoot, 'release', 'latest-mac.yml');
const identity = process.env.MAC_PDF_EDITOR_SIGNING_IDENTITY
  || 'Developer ID Application: Gabriele Lettera (58WG2698V4)';
const keychainProfile = process.env.MAC_PDF_EDITOR_NOTARY_PROFILE || 'MacPDFEditorNotary';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

if (!fs.existsSync(dmgPath)) throw new Error(`DMG non trovato: ${dmgPath}`);

run('/usr/bin/codesign', ['--force', '--sign', identity, '--timestamp', dmgPath]);
run('/usr/bin/xcrun', ['notarytool', 'submit', dmgPath, '--keychain-profile', keychainProfile, '--wait']);
run('/usr/bin/xcrun', ['stapler', 'staple', dmgPath]);
run('/usr/bin/xcrun', ['stapler', 'validate', dmgPath]);
run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmgPath]);

if (fs.existsSync(updateMetadataPath)) {
  const metadata = fs.readFileSync(updateMetadataPath, 'utf8');
  const zipOnlyMetadata = metadata.replace(
    /\n  - url: [^\n]+\.dmg\n    sha512: [^\n]+\n    size: \d+/g,
    '',
  );
  fs.writeFileSync(updateMetadataPath, zipOnlyMetadata);
}

console.log(`DMG ${packageJson.version} firmato, notarizzato e verificato.`);
