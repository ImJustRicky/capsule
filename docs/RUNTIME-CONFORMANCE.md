# Runtime Conformance

## Purpose

This document defines what software must do to call itself a Capsule 1.0 runtime.

There can be many runtimes:

- CLI runtime
- desktop runtime
- web runtime
- mobile runtime
- OS preview plugin
- embedded viewer

They should all agree on the same safety contract.

## Conformance Levels

### Level 0: Inspector

Can inspect capsules but not run them.

MUST:

- open `.capsule` archives
- reject malformed archives
- validate `capsule.json`
- display manifest metadata
- display requested capabilities
- display network policy
- display signature/integrity state when present

MUST NOT:

- execute capsule scripts
- load remote resources
- grant capabilities

### Level 1: Offline Runtime

Can run capsules without host capabilities.

MUST satisfy Level 0.

MUST:

- run entry content in sandbox
- deny network
- deny filesystem
- deny clipboard
- deny shell
- isolate storage or disable storage
- enforce CSP

### Level 2: Capability Runtime

Can grant V1 capabilities.

MUST satisfy Level 1.

MUST:

- implement capability bridge
- validate every bridge call
- expose only granted capabilities
- support grant denial
- support grant revocation
- write receipts for sensitive actions

### Level 3: Signed Runtime

Supports signing and trust decisions.

MUST satisfy Level 2.

MUST:

- verify supported signatures
- display signer state
- distinguish unsigned from failed verification
- tie persistent grants to signer/content identity

## Required Rejection Cases

A conforming runtime MUST reject:

- missing `capsule.json`
- invalid JSON manifest
- unsupported `capsule_version`
- invalid archive path
- symlink entry
- entry path outside archive
- missing entry file
- unknown required feature
- unsupported required capability
- integrity mismatch

## Required Warnings

A conforming runtime SHOULD warn:

- unsigned capsule
- large archive
- high compression ratio
- network access requested
- many capabilities requested
- modified since signing
- stale signature
- unrecognized optional fields

## Conformance Test Suite

The project should ship fixture capsules:

```text
fixtures/
  valid-minimal.capsule
  valid-storage.capsule
  valid-network-allowlist.capsule
  invalid-missing-manifest.capsule
  invalid-path-traversal.capsule
  invalid-symlink.capsule
  invalid-entry-missing.capsule
  invalid-unknown-required-feature.capsule
  invalid-integrity-mismatch.capsule
  malicious-zip-bomb-small.capsule
```

Every runtime should be able to run:

```bash
capsule conformance ./runtime-command
```

## Output Contract for CLI Inspector

`capsule inspect --json file.capsule` should output stable machine-readable JSON:

```json
{
  "valid": true,
  "capsule_version": "1.0",
  "name": "Loan Calculator",
  "slug": "loan-calculator",
  "entry": "content/index.html",
  "capabilities": [],
  "network": {
    "default": "deny",
    "allow": []
  },
  "integrity": {
    "status": "not_present"
  },
  "signature": {
    "status": "unsigned"
  },
  "warnings": []
}
```

