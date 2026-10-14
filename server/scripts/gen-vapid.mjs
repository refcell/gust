#!/usr/bin/env node
// Generate a VAPID (P-256) key pair and print the commands to configure the worker and the app build.
import { webcrypto as crypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = b64url(await crypto.subtle.exportKey('raw', kp.publicKey));
const { d } = await crypto.subtle.exportKey('jwk', kp.privateKey);
const subject = process.argv[2] ?? 'mailto:you@example.com';

console.log(`VAPID public key:  ${publicKey}
VAPID private key: ${d}   (keep secret)

# Worker secrets (run in server/):
printf '%s' '${publicKey}' | npx wrangler secret put VAPID_PUBLIC_KEY
printf '%s' '${d}' | npx wrangler secret put VAPID_PRIVATE_KEY
printf '%s' '${subject}' | npx wrangler secret put VAPID_SUBJECT

# App build (GitHub Actions repo variables):
gh variable set VITE_VAPID_PUBLIC_KEY --repo refcell/gust --body '${publicKey}'
gh variable set VITE_PUSH_API --repo refcell/gust --body 'https://gust-push.<your-subdomain>.workers.dev'

# Local dev (.env.local in the repo root / server/.dev.vars):
VITE_VAPID_PUBLIC_KEY=${publicKey}
`);
