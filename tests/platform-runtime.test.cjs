const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  backendLaunchConfiguration,
  pdfArgumentFromCommandLine,
  virtualEnvironmentPython,
} = require('../platform-runtime');

test('Windows uses its virtualenv and packaged backend executable', () => {
  assert.equal(
    virtualEnvironmentPython('C:\\PDF', 'win32'),
    'C:\\PDF\\.build-venv\\Scripts\\python.exe',
  );
  const packaged = backendLaunchConfiguration({
    isPackaged: true,
    platform: 'win32',
    resourcesPath: 'C:\\Program Files\\PDF\\resources',
    projectDirectory: 'C:\\source',
  });
  assert.equal(packaged.executable, 'C:\\Program Files\\PDF\\resources\\backend\\windows-pdf-backend.exe');
  assert.deepEqual(packaged.args, []);
});

test('macOS packaged backend name remains unchanged', () => {
  const packaged = backendLaunchConfiguration({
    isPackaged: true,
    platform: 'darwin',
    resourcesPath: '/Applications/Mac PDF Editor.app/Contents/Resources',
    projectDirectory: '/source',
  });
  assert.equal(packaged.executable, '/Applications/Mac PDF Editor.app/Contents/Resources/backend/mac-pdf-backend');
});

test('PDF command-line arguments work with Windows paths and spaces', () => {
  assert.equal(
    pdfArgumentFromCommandLine(
      ['Tomorrow Now PDF Editor.exe', '--original-process-start-time=1', 'C:\\Users\\Ada Lovelace\\contratto.PDF'],
      { platform: 'win32', workingDirectory: 'C:\\Users\\Ada Lovelace' },
    ),
    'C:\\Users\\Ada Lovelace\\contratto.PDF',
  );
  assert.equal(
    pdfArgumentFromCommandLine(['app.exe', '--inspect'], { platform: 'win32', workingDirectory: 'C:\\Temp' }),
    '',
  );
});
