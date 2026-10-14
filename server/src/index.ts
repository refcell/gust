import { runCron } from './cron';
import type { Env, ExecutionContextLike, ScheduledEventLike } from './env';
import { deleteSubscriber, endpointId, listSubscriberIds, putSubscriber } from './store';
import { MAX_BODY_BYTES, parseSubscribe, parseUnsubscribe } from './validate';

const DEFAULT_ORIGINS = ['https://refcell.github.io'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

export function isAllowedOrigin(origin: string, env: Pick<Env, 'ALLOWED_ORIGINS'>): boolean {
  if (LOCAL_ORIGIN.test(origin)) return true;
  const extra = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return DEFAULT_ORIGINS.includes(origin) || extra.includes(origin);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin, env)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors } });
}

async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'body too large' };
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'body too large' };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'invalid JSON' };
  }
}

export async function handleRequest(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  const cors = corsHeaders(origin, env);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return new Response(null, { status: origin && cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
  // Browsers always send Origin on cross-origin POST; reject unknown sites. Non-browser clients (no Origin) are allowed.
  if (req.method === 'POST' && origin && !cors['Access-Control-Allow-Origin']) return json({ ok: false, error: 'origin not allowed' }, 403, {});

  if (req.method === 'GET' && path === '/health') {
    const subscribers = (await listSubscriberIds(env.SUBS)).length;
    return json({ ok: true, subscribers }, 200, cors);
  }
  if (req.method === 'GET' && path === '/vapid') {
    if (!env.VAPID_PUBLIC_KEY) return json({ ok: false, error: 'VAPID_PUBLIC_KEY not configured' }, 500, cors);
    return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, cors);
  }
  if (req.method === 'POST' && path === '/subscribe') {
    const r = await readJson(req);
    if (!r.ok) return json({ ok: false, error: r.error }, r.status, cors);
    const p = parseSubscribe(r.body);
    if (!p.ok) return json({ ok: false, error: p.error }, 400, cors);
    await putSubscriber(env.SUBS, p.value);
    return json({ ok: true }, 200, cors);
  }
  if (req.method === 'POST' && path === '/unsubscribe') {
    const r = await readJson(req);
    if (!r.ok) return json({ ok: false, error: r.error }, r.status, cors);
    const p = parseUnsubscribe(r.body);
    if (!p.ok) return json({ ok: false, error: p.error }, 400, cors);
    await deleteSubscriber(env.SUBS, await endpointId(p.value.endpoint));
    return json({ ok: true }, 200, cors);
  }
  return json({ ok: false, error: 'not found' }, 404, cors);
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env);
  },
  scheduled(event: ScheduledEventLike, env: Env, ctx: ExecutionContextLike): void {
    ctx.waitUntil(
      runCron(env, event.scheduledTime).then((r) => {
        console.log('cron', JSON.stringify(r));
      }),
    );
  },
};
