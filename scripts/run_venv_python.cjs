const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { virtualEnvironmentPython } = require('../platform-runtime');

const projectDirectory = path.resolve(__dirname, '..');
const executable = virtualEnvironmentPython(projectDirectory);
const result = spawnSync(executable, process.argv.slice(2), {
  cwd: projectDirectory,
  env: {
    ...process.env,
    PYINSTALLER_CONFIG_DIR: process.env.PYINSTALLER_CONFIG_DIR
      || path.join(os.tmpdir(), 'tomorrow-now-pdf-editor-pyinstaller'),
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
