/**
 * Save a text file. Uses an anchor with `download` where supported. In an installed iOS web app
 * (where `download` is ignored) it prefers the share sheet with the file (Web Share Level 2, iOS
 * 15+; offers Calendar for .ics), then falls back to opening the Blob URL. Returns the path used.
 * Must be called from a user gesture (share and window.open require one).
 */
export function saveFile(text: string, filename: string, type: string, opts: { iosStandalone: boolean }): 'download' | 'share' | 'open' {
  if (opts.iosStandalone && typeof File === 'function' && navigator.canShare) {
    const file = new File([text], filename, { type });
    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: filename }).catch((e: unknown) => {
        // The user closing the sheet is not an error; anything else falls back to the Blob URL.
        if ((e as { name?: string })?.name !== 'AbortError') openBlob(text, type);
      });
      return 'share';
    }
  }
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
  openUrl(url);
  return 'open';
}

function openBlob(text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  openUrl(url);
}

function openUrl(url: string) {
  // Popup blocked (e.g. after an async share failure lost the user gesture): navigate instead.
  if (!window.open(url, '_blank')) location.href = url;
}
