const path = require('path');
const { notarize } = require('@electron/notarize');

module.exports = async function notarizeMacApp(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (context.packager.platformSpecificBuildOptions.identity === null) return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const keychainProfile = process.env.MAC_PDF_EDITOR_NOTARY_PROFILE || 'MacPDFEditorNotary';

  console.log(`Notarizzazione Apple di ${appName} con il profilo ${keychainProfile}…`);
  await notarize({
    appPath,
    keychainProfile,
  });
  console.log(`Notarizzazione Apple completata per ${appName}.`);
};
