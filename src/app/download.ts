/**
 * Save a text file. Uses an anchor with `download` where supported; in an installed iOS web app
 * (where `download` is ignored) or without `download` support, opens the Blob URL instead, which
 * iOS hands to Calendar for .ics files. Returns which path was used.
 */
export function saveFile(text: string, filename: string, type: string, opts: { iosStandalone: boolean }): 'download' | 'open' {
  const url = URL.createObjectURL(new Blob([text], { type }));
  // Give the browser (or Calendar) time to read the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const a = document.createElement('a');
  if (!opts.iosStandalone && 'download' in a) {
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'download';
  }
  if (!window.open(url, '_blank')) location.href = url;
  return 'open';
}
