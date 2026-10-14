import type { AlertState } from '../../src/lib/alerts';
import type { KV } from './env';
import type { Subscriber } from './validate';

export const SUB_PREFIX = 'sub:';
export const STATE_PREFIX = 'state:';

export async function endpointId(endpoint: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function putSubscriber(kv: KV, sub: Subscriber): Promise<string> {
  const id = await endpointId(sub.subscription.endpoint);
  await kv.put(SUB_PREFIX + id, JSON.stringify(sub));
  return id;
}

export async function deleteSubscriber(kv: KV, id: string): Promise<void> {
  await kv.delete(SUB_PREFIX + id);
  await kv.delete(STATE_PREFIX + id);
}

export async function getState(kv: KV, id: string): Promise<AlertState | null> {
  return (await kv.get(STATE_PREFIX + id, 'json')) as AlertState | null;
}

export async function putState(kv: KV, id: string, state: AlertState): Promise<void> {
  await kv.put(STATE_PREFIX + id, JSON.stringify(state));
}

/** All subscriber ids (KV list is paginated at 1000 keys). */
export async function listSubscriberIds(kv: KV): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: SUB_PREFIX, cursor });
    for (const k of page.keys) ids.push(k.name.slice(SUB_PREFIX.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return ids;
}

export async function getSubscriber(kv: KV, id: string): Promise<Subscriber | null> {
  return (await kv.get(SUB_PREFIX + id, 'json')) as Subscriber | null;
}
