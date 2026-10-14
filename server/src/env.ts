/** Minimal Workers runtime types used by this worker (avoids a @cloudflare/workers-types dependency). */

export interface KVListResult {
  keys: { name: string }[];
  list_complete: boolean;
  cursor?: string;
}

export interface KV {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<KVListResult>;
}

export interface Env {
  SUBS: KV;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  /** App URL opened from notifications. */
  APP_URL?: string;
  /** Extra allowed CORS origins, comma separated. */
  ALLOWED_ORIGINS?: string;
  /** Quiet hours in subscriber local time, "22-6". Empty string disables. */
  QUIET_HOURS?: string;
  /** Cap on push requests per cron run (Workers subrequest limits). */
  MAX_PUSHES?: string;
}

export interface ScheduledEventLike {
  scheduledTime: number;
  cron?: string;
}

export interface ExecutionContextLike {
  waitUntil(p: Promise<unknown>): void;
}
