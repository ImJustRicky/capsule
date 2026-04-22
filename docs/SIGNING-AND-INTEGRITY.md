# Signing and Integrity

## Goals

Capsule integrity has three jobs:

1. Detect accidental or malicious modification.
2. Show whether the author is known.
3. Let runtimes decide whether existing grants can safely carry forward.

## Content Hash

Every packed capsule SHOULD have a canonical content hash.

Manifest example:

```json
{
  "integrity": {
    "algorithm": "sha256",
    "content_hash": "sha256:0123456789abcdef..."
  }
}
```

## Hash Scope

The content hash SHOULD cover all archive entries except signature files that necessarily reference the hash.

Recommended V1 hash scope:

- `capsule.json` with `integrity.content_hash` omitted or set to a canonical placeholder
- `content/**`
- `assets/**`
- `metadata/**`
- `source/**`

Excluded:

- `signatures/**`
- runtime-local receipts
- platform-specific ZIP metadata

The reference packer must document canonicalization exactly before this is treated as stable.

## Canonicalization

The packer SHOULD canonicalize:

- path ordering
- path separators
- JSON key ordering for manifest hashing
- file timestamps
- file permissions
- compression metadata

## Signature State

Runtimes SHOULD display one of:

- signed and verified
- signed but unknown author
- signed but expired
- signed but revoked
- modified since signing
- unsigned
- verification failed

The difference between `unsigned` and `verification failed` must be clear.

## Signature Algorithms

V1 reference implementation SHOULD prefer:

- Ed25519 for signing
- SHA-256 for hashing

Future versions may add:

- key transparency logs
- certificate-based identities
- Sigstore-style signing
- decentralized identifiers

## Signature File Layout

Suggested:

```text
signatures/
  capsule.sig.json
```

Example:

```json
{
  "signature_version": "1.0",
  "algorithm": "ed25519",
  "signed_hash": "sha256:...",
  "signer": {
    "name": "Example Lab",
    "id": "did:web:example.com"
  },
  "signature": "base64:...",
  "created_at": "2026-04-21T00:00:00Z"
}
```

## Grant Carry-Forward

Persistent permission grants SHOULD be tied to:

- signer identity when verified
- capsule slug
- version or update channel
- content hash

Runtimes SHOULD NOT carry powerful grants from one unsigned capsule to another just because the filename or slug matches.

## Revocation

The standard should leave room for revocation metadata, but V1 can start with local runtime policy.

Possible future fields:

```json
{
  "revocation": {
    "url": "https://example.com/capsules/revocations.json",
    "mode": "optional-check"
  }
}
```

Network revocation checks must not create hidden background network access for capsules. The runtime may check revocation as part of its own update/security policy, but it must be transparent to users.

