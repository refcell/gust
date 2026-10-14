/**
 * Limits shared by the app and the push server (`server/src/validate.ts`).
 * The push server rejects a `/subscribe` body with more spots than this (KV size and the shared
 * Open-Meteo budget), so the client never sends more.
 */
export const MAX_PUSH_SPOTS = 60;
