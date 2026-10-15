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

// Live demo: show a still of the app first and boot the real app (in an iframe) only when the
// frame is mostly in view or the visitor taps Start, so it does not compete with the landing page
// for the main thread on first load.
const phone = document.querySelector<HTMLElement>('.demo .phone');
const startBtn = document.getElementById('demo-start') as HTMLButtonElement | null;
if (phone && startBtn) {
  let io: IntersectionObserver | null = null;
  const start = (focus: boolean) => {
    io?.disconnect();
    if (phone.querySelector('iframe')) return;
    const frame = document.createElement('iframe');
    frame.src = '/gust/app/?demo=1';
    frame.title = 'gust app, live demo with a fixed location';
    phone.append(frame);
    phone.classList.add('live');
    startBtn.hidden = true;
    if (focus) frame.focus();
  };
  startBtn.hidden = false;
  startBtn.addEventListener('click', () => start(true));
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver((entries) => entries.some((e) => e.intersectionRatio >= 0.6) && start(false), { threshold: 0.6 });
    // Auto-boot only after the visitor engages (scroll, wheel, touch, pointer, key): a viewport
    // resize alone (e.g. Lighthouse's full-page screenshot) must not boot the app mid-audit.
    const engage = ['scroll', 'wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    const onEngage = () => {
      for (const t of engage) removeEventListener(t, onEngage);
      io?.observe(phone);
    };
    for (const t of engage) addEventListener(t, onEngage, { passive: true });
  }
}
