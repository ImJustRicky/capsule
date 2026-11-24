# @capsule/runtime

Node sandbox host for running `.capsule` files (and self-opening `.capsule.html` files). Depends on [`@capsule/core`](../capsule-core) for format loading; everything else is a short-lived HTTP server + a bridge between the host page and a sandboxed iframe.

For opening capsules with nothing installed, see the browser viewer in [`@capsule/web`](../capsule-web). Both hosts share `src/host/bridge.js`.

## How it sandboxes

1. `startServer({ manifest, archive, token })` binds a Node HTTP server to `127.0.0.1` on a random port.
2. Every URL is gated by an unguessable path token (`/s/<24-byte-hex>/…`). Random local scripts can't reach the server even from localhost.
3. The host page at `/s/<token>/host.html` renders the Open Screen, opens the capsule's entry inside an `<iframe sandbox="allow-scripts">` (no `allow-same-origin` → null origin, no cookies, no localStorage, no parent access).
4. Capsule content is served with a strict per-asset CSP: `default-src 'none'`, `script-src 'self' 'unsafe-inline'` (so single-file apps run; no `eval`), `connect-src 'none'`, `frame-ancestors 'self'`. Network access goes through the host's `network.fetch` proxy, which enforces the allowlist and blocks private addresses after DNS resolution.
5. `bridge.js` is auto-injected into HTML entries. It exposes `window.capsule.request(capability, method, args)` which `postMessage`s to the host. The host mediates every call.

## Public API

```ts
import { runCapsule } from "@capsule/runtime";

const { server } = await runCapsule("foo.capsule", {
  headless: false,   // open a chromeless browser window; false = stay local
  port: 0,           // 0 picks a free port
});

// server.url is the host page URL; server.close() shuts it down.
```

Lower level:

```ts
import { startServer, createSessionToken } from "@capsule/runtime";

const server = await startServer({ manifest, archive, token: createSessionToken() });
```

## Bridge protocol

Requests (capsule → host):

```json
{ "kind": "capsule-request", "id": "c1", "capability": "storage.local", "method": "get", "args": { "key": "x" } }
```

Responses (host → capsule):

```json
{ "kind": "capsule-response", "id": "c1", "ok": false, "error": "capability.denied", "message": "…" }
```

All messages are correlation-id'd; denials are never exceptions, they're an `ok: false` envelope.

## Testing

```bash
pnpm test      # vitest — hits real HTTP routes on an ephemeral port
pnpm typecheck
```
