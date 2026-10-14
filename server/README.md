# gust push backend

A small Web Push sender for gust: a Cloudflare Worker with a KV namespace and a Cron Trigger.

- The app (built with `VITE_PUSH_API` and `VITE_VAPID_PUBLIC_KEY`) posts its push subscription,
  settings, watched spots, and time zone to `/subscribe`.
- Every 30 minutes the cron fetches Open-Meteo for all subscribers' spots (deduplicated, batched),
  scores them with the same code as the app (`../src/lib/score.ts`, `forecast.ts`, `alerts.ts`,
  `openmeteo.ts`), and sends a push for each new alert: a spot turning good, or a good window
  ahead. Per-subscriber alert state lives in KV, so a spot only alerts when it changes.
- Payloads are encrypted per RFC 8291 (`aes128gcm`) and signed with VAPID (RFC 8292, ES256),
  implemented on WebCrypto in `src/webpush.ts`. There are no runtime dependencies.

## API

| Method | Path           | Body / response |
| ------ | -------------- | --------------- |
| POST   | `/subscribe`   | `{subscription, settings, location, spots: [{id, name, lat, lon, sectors}], tz}` → `{ok: true}`. Upsert keyed by SHA-256 of the endpoint. Max 60 spots, 64 KB body. |
| POST   | `/unsubscribe` | `{endpoint}` → `{ok: true}` |
| GET    | `/health`      | `{ok: true, subscribers: n}` |
| GET    | `/vapid`       | `{publicKey}` |

CORS allows `https://refcell.github.io` and `http://localhost:*` / `http://127.0.0.1:*`. Add more
with the `ALLOWED_ORIGINS` var. POSTs from other browser origins get 403.

Push payloads are `{title, body, tag, url}`; the app's service worker shows them as-is. A
subscriber gets at most 3 notifications per run; extra alerts are folded into one summary. A push
service response of 404 or 410 deletes the subscription.

## Deploy (Cloudflare, free plan)

```sh
cd server
pnpm i
npx wrangler login
npx wrangler kv namespace create SUBS     # paste the printed id into wrangler.toml
pnpm run gen-vapid mailto:you@example.com # prints the commands below with real values
printf '%s' '<public key>'  | npx wrangler secret put VAPID_PUBLIC_KEY
printf '%s' '<private key>' | npx wrangler secret put VAPID_PRIVATE_KEY
printf '%s' 'mailto:you@example.com' | npx wrangler secret put VAPID_SUBJECT
pnpm run deploy
```

`wrangler deploy` prints the worker URL, for example `https://gust-push.<subdomain>.workers.dev`.
Check it with `curl https://gust-push.<subdomain>.workers.dev/health`.

`VAPID_PRIVATE_KEY` accepts the base64url private scalar `d` (what `gen-vapid` prints) or a
JSON-encoded JWK. Keep the key pair stable: rotating it invalidates every existing subscription.

### Enable push in the app build

The Pages workflow passes two repository variables to `pnpm build`. Set them and re-run CI:

```sh
gh variable set VITE_PUSH_API --repo refcell/gust --body 'https://gust-push.<subdomain>.workers.dev'
gh variable set VITE_VAPID_PUBLIC_KEY --repo refcell/gust --body '<public key>'
gh workflow run CI --repo refcell/gust
```

For local development put the same values in `.env.local` at the repo root.

### Configuration (`wrangler.toml` `[vars]`)

| Var               | Default                                | Meaning |
| ----------------- | -------------------------------------- | ------- |
| `APP_URL`         | `https://refcell.github.io/gust/app/`  | Opened when a notification is tapped (`?spot=<id>` is appended). |
| `ALLOWED_ORIGINS` | empty                                  | Extra CORS origins, comma separated. |
| `QUIET_HOURS`     | `22-6`                                 | Subscriber-local hours with no pushes. During quiet hours the subscriber is skipped and its state is left alone, so a spot that turns good overnight alerts at the end of quiet hours. Empty disables. |
| `MAX_PUSHES`      | `40`                                   | Push requests per cron run. |

### Limits

- Workers free plan: 50 subrequests per invocation. Each Open-Meteo request (up to 50 unique
  spots) and each push counts as one, so one cron run serves roughly 40 notifications. When
  `MAX_PUSHES` is reached, the rest of that run's alerts are dropped (state still advances).
  On the paid plan, raise `MAX_PUSHES` (limit 1000 subrequests).
- KV free plan: 1000 writes per day. A subscriber's state is written only when a rating changes
  or an alert fires, typically a few times a day per subscriber, so the free plan covers on the
  order of a hundred subscribers. Beyond that, use the paid plan or reduce the cron frequency.
- Open-Meteo free API: 10,000 calls per day, non-commercial use.

## Development

```sh
cd server
pnpm i
pnpm test           # vitest: RFC 8291 vector + round trip, VAPID JWT, validation, HTTP, cron flow
pnpm typecheck
pnpm dev            # wrangler dev; create .dev.vars with the three VAPID_* values
curl 'http://localhost:8787/__scheduled?cron=*/30+*+*+*+*'   # run the cron locally
```

The server tests import only the worker source and `../src/lib`, so the root `pnpm test` runs
them too, and CI covers them without installing `server/` dependencies. From the repo root,
`pnpm test:server` runs them with the server's own vitest, and `pnpm typecheck:server` typechecks
the worker.

## Deno Deploy alternative

The worker uses only web-standard APIs (`fetch`, WebCrypto, `Intl`). To run it on Deno Deploy,
write a small entry that adapts Deno KV to the `KV` interface in `src/env.ts`
(`get`/`put`/`delete`/`list` with a `sub:` prefix), calls `handleRequest(req, env)` from
`Deno.serve`, and registers `Deno.cron('gust', '*/30 * * * *', () => runCron(env))`. Put the VAPID
values in Deno Deploy environment variables.
