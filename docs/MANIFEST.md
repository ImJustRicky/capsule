# Manifest

## Overview

Every capsule contains a manifest at:

```text
capsule.json
```

The manifest is the capsule's permission contract and identity document.

It tells the runtime:

- what the capsule is
- who made it
- where the entry point is
- what capabilities it requests
- what network hosts it may contact
- what integrity metadata should be verified
- what standard features it requires

## Minimal Manifest

```json
{
  "capsule_version": "1.0",
  "name": "Loan Calculator",
  "slug": "loan-calculator",
  "version": "0.1.0",
  "entry": "content/index.html",
  "description": "Offline loan calculator with local-only scenario storage.",
  "permissions": [],
  "network": {
    "default": "deny",
    "allow": []
  }
}
```

## Field Reference

### `capsule_version`

Required string.

The Capsule standard version targeted by the archive.

V1 value:

```json
"1.0"
```

### `name`

Required string.

Human-readable display name.

### `slug`

Required string.

Stable lowercase identifier.

Recommended pattern:

```text
^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
```

### `version`

Required string.

The capsule author's version. SemVer is recommended but not required by the archive format.

### `description`

Required string.

Short human-readable purpose. This is shown on the inert preview screen.

### `entry`

Required string.

Path to the first content file loaded by the runtime.

### `author`

Optional object.

```json
{
  "name": "Example Lab",
  "id": "did:web:example.com",
  "url": "https://example.com"
}
```

### `permissions`

Required array.

Each item declares a requested capability.

```json
{
  "capability": "storage.local",
  "scope": "capsule",
  "reason": "Save your settings locally"
}
```

Runtimes MUST show capability requests before running the capsule.

### `network`

Required object.

```json
{
  "default": "deny",
  "allow": ["api.weather.gov"]
}
```

V1 default MUST be `deny`.

### `features`

Optional object.

Used to declare required and optional standard features.

```json
{
  "required": ["capability.storage.local"],
  "optional": ["signing.ed25519"]
}
```

A runtime MUST reject the capsule if any required feature is unknown or unsupported.

### `integrity`

Optional object.

```json
{
  "content_hash": "sha256:...",
  "algorithm": "sha256"
}
```

Runtimes MUST block execution if integrity metadata exists and verification fails.

### `display`

Optional object.

```json
{
  "icon": "assets/icon.png",
  "accent_color": "#4466ff",
  "preferred_size": {
    "width": 960,
    "height": 720
  }
}
```

Display metadata MUST NOT affect security decisions.

### `license`

Optional object.

```json
{
  "name": "MIT",
  "url": "https://opensource.org/license/mit"
}
```

### `source`

Optional object.

```json
{
  "url": "https://github.com/example/loan-calculator",
  "path": "source/README.md"
}
```

### `privacy`

Optional object for human-readable claims.

```json
{
  "summary": "Works offline. Does not send data anywhere.",
  "data_stored": ["loan scenarios"],
  "data_shared": []
}
```

Privacy claims are not enforcement. The capability model is enforcement.

## Full Example

```json
{
  "capsule_version": "1.0",
  "name": "Weather Poster",
  "slug": "weather-poster",
  "version": "0.1.0",
  "description": "Build a printable weather poster from the public weather API.",
  "entry": "content/index.html",
  "author": {
    "name": "Capsule Examples",
    "url": "https://example.org"
  },
  "permissions": [
    {
      "capability": "network.fetch",
      "scope": ["api.weather.gov"],
      "reason": "Fetch weather data"
    },
    {
      "capability": "filesystem.export",
      "scope": "user-picked-location",
      "reason": "Export poster as PNG"
    }
  ],
  "network": {
    "default": "deny",
    "allow": ["api.weather.gov"]
  },
  "display": {
    "icon": "assets/icon.png",
    "accent_color": "#2f6fed"
  },
  "privacy": {
    "summary": "Fetches weather data only from api.weather.gov. Exports files only where you choose.",
    "data_stored": [],
    "data_shared": ["zip code or coordinates sent to api.weather.gov"]
  }
}
```

