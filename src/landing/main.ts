import { renderSVG } from 'uqr';
import { detectPlatform } from '../lib/platform';
import './landing.css';

const SITE = 'https://refcell.github.io/gust/';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const p = detectPlatform();
const btn = document.getElementById('install') as HTMLButtonElement;
const note = document.getElementById('install-note') as HTMLElement;
const sheet = document.getElementById('ios-sheet') as HTMLDialogElement;
const iosExtra = document.getElementById('ios-extra') as HTMLElement;
let deferred: BeforeInstallPromptEvent | null = null;

addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  note.textContent = '';
});

addEventListener('appinstalled', () => {
  deferred = null;
  btn.textContent = 'Installed';
  note.textContent = 'gust is installed. Open it from your home screen or app list.';
});

if (p.standalone) {
  btn.textContent = 'Open gust';
} else if (p.inApp) {
  note.textContent = `${p.inApp} opens links in its own browser, which cannot install apps. Open this page in ${p.ios ? 'Safari' : 'Chrome'} to install.`;
}
if (p.android) document.getElementById('apk')!.hidden = false;

btn.addEventListener('click', async () => {
  if (p.standalone) {
    location.href = '/gust/app/';
    return;
  }
  if (deferred) {
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === 'accepted') note.textContent = 'Installing…';
    return;
  }
  if (p.ios) {
    iosExtra.textContent = p.inApp
      ? `You are in ${p.inApp}’s built-in browser. Tap the menu (… or the compass icon) and choose Open in Safari first.`
      : p.iosSafari
        ? ''
        : 'In Chrome or another browser on iOS 16.4+, the Share button is in the address bar. If you do not see Add to Home Screen, open this page in Safari.';
    sheet.showModal();
    return;
  }
  if (p.mobile) {
    note.textContent = p.inApp
      ? `Open this page in Chrome to install (${p.inApp}’s browser cannot install apps).`
      : 'Open your browser menu and choose Install app or Add to Home screen.';
    return;
  }
  // Desktop without an install prompt: point at the QR code.
  note.textContent = 'gust is built for your phone. Scan the code below, or install from your browser’s address bar.';
  document.getElementById('qr-section')?.scrollIntoView({ behavior: 'smooth' });
});

// Desktop: show a QR code for the phone.
if (!p.mobile) {
  const qr = document.getElementById('qr')!;
  qr.innerHTML = renderSVG(SITE, { border: 1, pixelSize: 6 });
  document.getElementById('qr-section')!.hidden = false;
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(__BASE__ + 'sw.js', { scope: __BASE__ }).catch(() => undefined);
}
