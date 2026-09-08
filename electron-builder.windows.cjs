const { build } = require('./package.json');

const {
  artifactName: _macArtifactName,
  dmg: _dmg,
  extraResources: _macResources,
  mac: _mac,
  publish: _publish,
  ...shared
} = build;

module.exports = {
  ...shared,
  appId: 'tech.tomorrownow.pdfeditor',
  productName: 'Tomorrow Now PDF Editor',
  publish: null,
  artifactName: 'Tomorrow-Now-PDF-Editor-${version}-Windows-${arch}.${ext}',
  extraResources: [
    {
      from: 'dist/windows-pdf-backend.exe',
      to: 'backend/windows-pdf-backend.exe',
    },
    {
      from: 'scripts/windows_pdf_ocr.ps1',
      to: 'backend/windows_pdf_ocr.ps1',
    },
    {
      from: 'assets/fonts',
      to: 'fonts',
    },
  ],
  fileAssociations: [{
    ext: 'pdf',
    name: 'TomorrowNowPDFDocument',
    description: 'Documento PDF',
  }],
  win: {
    icon: 'build/icon_1024.png',
    target: [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }],
    legalTrademarks: 'Tomorrow Now',
  },
  nsis: {
    oneClick: false,
    perMachine: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Tomorrow Now PDF Editor',
  },
};
