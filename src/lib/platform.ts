export interface Platform {
  ios: boolean;
  android: boolean;
  /** Safari on iOS (the browser that can Add to Home Screen everywhere). */
  iosSafari: boolean;
  /** Embedded browser (Instagram, Facebook, TikTok, ...) that cannot install. */
  inApp: string | null;
  standalone: boolean;
  mobile: boolean;
}

const IN_APP: [RegExp, string][] = [
  [/Instagram/i, 'Instagram'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/Messenger/i, 'Messenger'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'],
  [/\bLine\//i, 'LINE'],
  [/Snapchat/i, 'Snapchat'],
  [/Twitter|TwitterAndroid/i, 'X'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Pinterest/i, 'Pinterest'],
  [/WhatsApp/i, 'WhatsApp'],
  [/MicroMessenger/i, 'WeChat'],
  [/\bGSA\//i, 'Google app'],
];

export function detectPlatform(ua = navigator.userAgent, nav: Navigator = navigator, win: Window = window): Platform {
  const ipadOs = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || ipadOs;
  const android = /Android/.test(ua);
  const inApp = IN_APP.find(([re]) => re.test(ua))?.[1] ?? null;
  const otherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
  const iosSafari = ios && !otherIosBrowser && !inApp && /Safari/.test(ua);
  const standalone =
    (win.matchMedia?.('(display-mode: standalone)').matches ?? false) || (nav as Navigator & { standalone?: boolean }).standalone === true;
  return { ios, android, iosSafari, inApp, standalone, mobile: ios || android || /Mobi/.test(ua) };
}
