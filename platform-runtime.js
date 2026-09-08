const path = require('node:path');

function virtualEnvironmentPython(projectDirectory, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  return platform === 'win32'
    ? pathApi.join(projectDirectory, '.build-venv', 'Scripts', 'python.exe')
    : pathApi.join(projectDirectory, '.build-venv', 'bin', 'python');
}

function backendLaunchConfiguration({
  isPackaged,
  platform = process.platform,
  resourcesPath,
  projectDirectory,
}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const executableName = platform === 'win32'
    ? 'windows-pdf-backend.exe'
    : 'mac-pdf-backend';
  const executable = isPackaged
    ? pathApi.join(resourcesPath, 'backend', executableName)
    : virtualEnvironmentPython(projectDirectory, platform);

  return {
    executable,
    args: isPackaged ? [] : [pathApi.join(projectDirectory, 'backend', 'main.py')],
    cwd: isPackaged ? pathApi.dirname(executable) : projectDirectory,
    fonts: isPackaged
      ? pathApi.join(resourcesPath, 'fonts')
      : pathApi.join(projectDirectory, 'assets', 'fonts'),
  };
}

function pdfArgumentFromCommandLine(argv, {
  platform = process.platform,
  workingDirectory = process.cwd(),
} = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const candidate = [...argv].reverse().find((argument) => (
    typeof argument === 'string'
    && !argument.startsWith('--')
    && pathApi.extname(argument).toLowerCase() === '.pdf'
  ));
  if (!candidate) return '';
  return pathApi.isAbsolute(candidate)
    ? pathApi.normalize(candidate)
    : pathApi.resolve(workingDirectory, candidate);
}

module.exports = {
  backendLaunchConfiguration,
  pdfArgumentFromCommandLine,
  virtualEnvironmentPython,
};
