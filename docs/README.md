# Capsule Docs

Capsule is an open format for portable, sandboxed, interactive documents.

The long-term goal is simple:

```text
PDFs made documents portable.
Capsules make interactive documents portable.
```

A `.capsule` file is a single shareable archive that contains an interactive document, its assets, a manifest, integrity metadata, and a permission contract. It can be inspected before it runs. It cannot read the user's machine, use the network, run native code, or update itself unless the runtime grants explicit capabilities.

## Current Status

These documents are a V1 draft. They are written as a standards foundation, not just implementation notes.

The V1 implementation should treat these files as the source of truth:

- [CAPSULE-1.0-DRAFT.md](./CAPSULE-1.0-DRAFT.md): high-level standard
- [ARCHIVE-FORMAT.md](./ARCHIVE-FORMAT.md): `.capsule` archive layout
- [MANIFEST.md](./MANIFEST.md): `capsule.json` fields
- [MANIFEST-1.0.schema.json](./MANIFEST-1.0.schema.json): JSON Schema for manifests
- [CAPABILITY-MODEL.md](./CAPABILITY-MODEL.md): permission system
- [SECURITY-MODEL.md](./SECURITY-MODEL.md): sandbox and threat model
- [SIGNING-AND-INTEGRITY.md](./SIGNING-AND-INTEGRITY.md): hashing, signatures, provenance
- [RUNTIME-CONFORMANCE.md](./RUNTIME-CONFORMANCE.md): what a compatible runtime must do
- [OS-INTEGRATION.md](./OS-INTEGRATION.md): file extension, MIME, icons, previews
- [AUTHORING-GUIDE.md](./AUTHORING-GUIDE.md): how to make safe capsules

## Design Principles

1. A capsule is a document before it is an app.
2. Opening a capsule is safe by default.
3. Inspection must work before execution.
4. Capabilities are explicit and narrow.
5. Network access is denied unless declared.
6. Local files are never ambient.
7. Updates are never silent.
8. Provenance must be visible.
9. The format must be implementable by more than one runtime.
10. The archive must remain useful decades from now.

## File Format Summary

```text
example.capsule
  capsule.json
  content/
    index.html
    app.js
    style.css
  assets/
  metadata/
  signatures/
```

`capsule.json` is the manifest. It defines the entry point, requested capabilities, network policy, integrity metadata, author information, and human-readable purpose.

## V1 Runtime Summary

The reference runtime should:

- open `.capsule` archives
- validate archive structure
- parse and validate `capsule.json`
- show an inert preview before execution
- verify content hashes
- run content in a sandboxed web runtime
- deny all host access by default
- expose only declared and granted capabilities
- keep storage isolated per capsule identity
- write local receipts for permission grants and meaningful actions

## V1 Non-Goals

V1 does not include:

- shell execution
- native plugins
- automatic updates
- arbitrary local file access
- clipboard read
- camera, microphone, or location
- background execution
- marketplace governance

Those can be considered later only if the security model remains comprehensible to normal users.

