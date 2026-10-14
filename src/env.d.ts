/// <reference types="vite/client" />
declare const __BASE__: string;
declare const __PRECACHE__: string[];
declare const __SW_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_PUSH_API?: string;
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}
