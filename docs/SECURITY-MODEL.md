# Security Model

## Security Promise

A user should be able to inspect a capsule before it can execute code or access host resources.

The runtime's default posture is:

```text
Open safely.
Inspect first.
Run sandboxed.
Grant narrowly.
Record sensitive actions.
```

## Threat Model

Capsule V1 assumes capsules may be malicious.

The runtime defends against:

- archive path traversal
- ZIP bombs
- malformed manifests
- misleading capability requests
- hidden network calls
- local file exfiltration
- shell execution
- environment variable theft
- token theft
- clipboard theft
- silent updates
- cross-capsule data access
- signature stripping or tampering
- confusing signed and unsigned states

V1 does not fully solve:

- malicious content that tricks the user socially
- phishing inside the capsule UI
- user-approved data exfiltration
- vulnerabilities in the underlying browser engine
- malicious runtimes

## Inert Preview Requirement

A runtime MUST support an inert preview phase.

During preview:

- no capsule scripts run
- no capsule network requests occur
- no capsule storage is opened for mutation
- no capability bridge exists
- no entry HTML is rendered as active content

The preview is built from parsed manifest metadata and static archive information only.

## Sandbox Requirements

V1 runtime content SHOULD run in a browser-grade sandbox.

Minimum restrictions:

- no Node.js APIs
- no direct filesystem APIs
- no shell APIs
- no environment variables
- no arbitrary native module loading
- no privileged browser APIs unless mediated
- no same-origin access to runtime UI
- no direct access to other capsules

If the runtime uses Electron, it MUST:

- set `nodeIntegration: false`
- set `contextIsolation: true`
- set `sandbox: true`
- avoid exposing unrestricted `ipcRenderer`
- expose only a narrow audited preload bridge
- validate every IPC call in the main process

## Content Security Policy

Runtimes SHOULD enforce a strict CSP.

Baseline:

```text
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src <declared allowlist>;
worker-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
```

The runtime may adjust CSP to support specific safe features, but it MUST NOT allow undeclared network hosts.

## Network Enforcement

Network access is denied by default.

When `network.fetch` is granted:

- runtime enforces host allowlist
- runtime blocks undeclared redirects
- runtime should normalize hostnames
- runtime should reject wildcard hosts in V1
- runtime should record first use in receipts

The capsule content's own `fetch` may be blocked and replaced by host-mediated fetch. This is preferable because the runtime can enforce policy consistently.

## Storage Isolation

Each capsule gets a storage namespace based on a runtime-computed capsule identity.

Storage MUST NOT be shared by:

- filename alone
- display name alone
- unsigned modified archive unless explicitly migrated

Runtime SHOULD provide:

- clear storage reset
- per-capsule storage size display
- export/import of capsule-owned storage

## Anti-Phishing UI Requirements

The runtime should prevent capsules from impersonating permission dialogs.

Recommended:

- permission dialogs are native/runtime chrome, not in capsule content
- runtime chrome has a consistent trusted visual style
- runtime shows capsule name and signature state during permission prompts
- runtime blocks fullscreen permission prompts in V1

## Receipts

Receipts are local audit records.

The runtime SHOULD record:

- capsule opened
- capsule ran
- permission granted
- permission denied
- network capability first used
- file imported
- file exported
- clipboard written
- integrity failure
- signature failure

Receipts SHOULD NOT contain private imported file contents by default.

## Panic Switch

The runtime SHOULD provide global controls:

- disable all capsule execution
- revoke all network grants
- revoke all persistent grants
- clear all capsule storage
- open safe mode

## Safe Mode

Safe mode should:

- inspect only
- run nothing
- ignore persistent grants
- disable all network
- disable all exports

Safe mode gives users a recovery path if they suspect a capsule is malicious.

