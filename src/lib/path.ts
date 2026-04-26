export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[/\\]+/).filter(Boolean);
  return segments[segments.length - 1] || path;
}

export function collapsePath(path: string, head = 2, tail = 2): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[/\\]+/).filter(Boolean);
  if (segments.length <= head + tail) {
    return trimmed || path;
  }

  const separator = path.includes('\\') ? '\\' : '/';
  const isUncPath = path.startsWith('\\\\');
  const hasLeadingSeparator = path.startsWith('/') || path.startsWith('\\');
  const prefix = isUncPath ? '\\\\' : hasLeadingSeparator ? separator : '';

  return `${prefix}${segments.slice(0, head).join(separator)}${separator}...${separator}${segments.slice(-tail).join(separator)}`;
}
