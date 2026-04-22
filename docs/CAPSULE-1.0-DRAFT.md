# Capsule 1.0 Draft

## Abstract

Capsule is a file format and runtime contract for portable, sandboxed, interactive documents.

A Capsule document is distributed as a single `.capsule` archive. The archive contains web-compatible content, assets, metadata, a permission manifest, and optional signatures. A conforming runtime can inspect the document without running it, display its requested capabilities, verify its integrity, and run it in a restricted environment.

## Terminology

The words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are used in their standards sense.

- **Capsule**: a `.capsule` archive.
- **Runtime**: software that opens, inspects, verifies, and runs capsules.
- **Author**: the person or organization that created the capsule.
- **Manifest**: the `capsule.json` file at the archive root.
- **Entry point**: the first document loaded by the runtime.
- **Capability**: an explicit host permission requested by the capsule.
- **Grant**: a runtime/user decision allowing a capability.
- **Receipt**: a durable local record of permission grants, denials, and sensitive host interactions.
- **Inert preview**: a metadata-only view that does not execute capsule content.

## Standard Goals

Capsule 1.0 aims to define:

- a durable archive layout
- a manifest schema
- a capability model
- a minimum sandbox model
- integrity verification
- signing and provenance hooks
- conformance requirements
- OS integration guidance

## Standard Non-Goals

Capsule 1.0 does not define:

- a centralized marketplace
- a single required UI
- an authoring application
- a package registry
- native code execution
- background services
- a general-purpose app installation model

## User Promise

A conforming runtime should make this promise true:

```text
You can open a capsule, inspect what it is, see what it wants to do,
and decide whether to run it before it can touch your machine.
```

## Required Runtime Phases

A runtime MUST separate opening a capsule into phases:

1. **Load archive**
   - Read the archive structure.
   - Reject malformed archives.
   - Do not run capsule content.

2. **Validate manifest**
   - Parse `capsule.json`.
   - Validate it against the supported schema.
   - Reject unsupported required features.

3. **Inspect**
   - Display name, author, version, purpose, signature state, entry point, requested capabilities, and network policy.
   - Do not run capsule scripts.

4. **Verify**
   - Check integrity metadata when present.
   - Warn on missing signatures.
   - Block on hash mismatch.

5. **Grant**
   - Ask the user or policy engine for required capabilities.
   - Persist grants only when explicitly requested.

6. **Run**
   - Start a sandbox.
   - Load only the declared entry point.
   - Expose only granted capabilities.

7. **Record**
   - Record security-relevant actions as local receipts.

## Capsule Identity

A capsule's runtime identity SHOULD be derived from:

- manifest `slug`
- manifest `author.id` when present
- manifest `version`
- archive content hash

The runtime MUST NOT use filename alone as identity.

Storage grants SHOULD be scoped to a stable capsule origin computed by the runtime. A modified capsule SHOULD NOT automatically inherit trusted grants from an earlier signed version unless the runtime can prove an acceptable update relationship.

## Compatibility

A runtime MUST reject a capsule when:

- `capsule_version` is unsupported
- a required capability is unknown
- the manifest is invalid
- the entry path is missing
- the entry path escapes the archive root
- integrity metadata exists and fails verification

A runtime MAY run a capsule with unknown optional metadata fields if the schema permits them.

## Standard File Extension

The standard file extension is:

```text
.capsule
```

The recommended MIME type is:

```text
application/vnd.capsule+zip
```

The archive is ZIP-compatible, but runtimes MUST treat `.capsule` as its own document type rather than a generic ZIP file.

## Minimum V1 Content Model

V1 capsules SHOULD use web-compatible content:

- HTML
- CSS
- JavaScript
- images
- fonts
- JSON
- WASM only when allowed by runtime policy

V1 runtimes MUST NOT expose Node.js, Deno, Bun, Python, Ruby, shell, or native host APIs directly to capsule content.

## Default Deny

Everything not explicitly allowed is denied.

This includes:

- filesystem reads
- filesystem writes outside export picker
- shell commands
- environment variables
- network
- clipboard read
- clipboard write without capability
- local device APIs
- background execution
- hidden update checks

## Standard Evolution

Future versions should preserve these compatibility rules:

- A 1.0 runtime must fail closed on unsupported required features.
- New capabilities should be additive.
- Unsafe features should require explicit capability names.
- Runtimes should keep old capsules inspectable even if they cannot run them.

