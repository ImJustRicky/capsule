# OS Integration

## Goal

The long-term goal is for operating systems to understand `.capsule` files the way they understand PDFs, EPUBs, or ZIP-based office documents.

That requires:

- stable file extension
- registered MIME type
- safe preview behavior
- clear iconography
- installable runtime
- conformance suite
- no dependence on one vendor

## File Extension

Standard extension:

```text
.capsule
```

## MIME Type

Recommended MIME type:

```text
application/vnd.capsule+zip
```

Early implementations may also use:

```text
application/x-capsule
```

The standards track should eventually register the vendor MIME type properly.

## macOS

Suggested Uniform Type Identifier:

```text
org.capsule.capsule
```

Conforms to:

```text
public.data
public.archive
```

Quick Look plugin behavior:

- inspect only
- no script execution
- show name, description, author, signature, permissions
- optionally show static screenshot if bundled in metadata

## Windows

Suggested ProgID:

```text
Capsule.Document
```

Suggested shell behavior:

- double-click opens runtime preview screen
- preview pane is inert
- context menu includes Inspect, Verify, Run, Export Contents

## Linux

Suggested desktop MIME registration:

```text
application/vnd.capsule+zip
```

Suggested `.desktop` actions:

- Open
- Inspect
- Verify

## Browser Integration

Browsers should not directly execute `.capsule` archives from the web.

Safer options:

- download then open in runtime
- inspect in web viewer without running
- run only through a trusted web runtime with no host capabilities

## Icon Design Requirements

The icon should communicate:

- document
- interactivity
- safety/sandbox

Avoid:

- app-store style branding
- robot imagery
- executable/package imagery that implies unsafe install

## File Preview Metadata

Capsules may include static preview metadata in:

```text
metadata/preview.json
metadata/preview.png
```

Preview data MUST be treated as untrusted and inert.

Example:

```json
{
  "title": "Loan Calculator",
  "summary": "Offline interactive calculator",
  "screenshot": "metadata/preview.png"
}
```

## Out-of-the-Box Ambition

Native OS support will require adoption first.

Recommended path:

1. Publish open spec.
2. Ship CLI inspector.
3. Ship desktop runtime.
4. Ship conformance fixtures.
5. Ship example capsules.
6. Build OS preview plugins.
7. Encourage third-party runtimes.
8. Register MIME type.
9. Standardize through a neutral home if adoption grows.

