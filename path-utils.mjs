export function createFilePaths(platform = 'posix') {
  const isWindows = platform === 'win32';

  function normalize(value) {
    const source = String(value || '').replaceAll('\\', '/');
    const driveMatch = isWindows ? source.match(/^([A-Za-z]:)(?:\/|$)/) : null;
    const drive = driveMatch?.[1] || '';
    const unc = isWindows && !drive && source.startsWith('//');
    const absolute = Boolean(drive || unc || source.startsWith('/'));
    const body = drive ? source.slice(drive.length) : (unc ? source.replace(/^\/+/, '') : source);
    const parts = [];
    const minimumParts = unc ? 2 : 0;
    body.split('/').forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') {
        if (parts.length > minimumParts && parts.at(-1) !== '..') parts.pop();
        else if (!absolute) parts.push(part);
      } else {
        parts.push(part);
      }
    });
    if (drive) return parts.length ? `${drive}/${parts.join('/')}` : `${drive}/`;
    if (unc) return parts.length ? `//${parts.join('/')}` : '//';
    if (absolute) return `/${parts.join('/')}` || '/';
    return parts.join('/') || '.';
  }

  function basename(value) {
    const normalized = normalize(value).replace(/\/$/, '');
    return normalized.slice(normalized.lastIndexOf('/') + 1);
  }

  function dirname(value) {
    const normalized = normalize(value).replace(/\/$/, '');
    const index = normalized.lastIndexOf('/');
    if (index < 0) return '.';
    if (index === 0) return '/';
    if (isWindows && index === 2 && /^[A-Za-z]:/.test(normalized)) return `${normalized.slice(0, 2)}/`;
    return normalized.slice(0, index);
  }

  function parse(value) {
    const base = basename(value);
    const dot = base.lastIndexOf('.');
    const hasExtension = dot > 0;
    return {
      base,
      name: hasExtension ? base.slice(0, dot) : base,
      ext: hasExtension ? base.slice(dot) : '',
    };
  }

  function join(...parts) {
    return normalize(parts.filter(Boolean).join('/'));
  }

  function comparable(value) {
    const normalized = normalize(value);
    return isWindows ? normalized.toLocaleLowerCase('en-US') : normalized;
  }

  return Object.freeze({ normalize, basename, dirname, parse, join, resolve: comparable });
}
