# Authoring Guide

## What to Make

Good capsules are interactive documents, not full applications.

Strong V1 examples:

- offline calculator
- interactive explainer
- printable form
- simulation
- small educational lesson
- local data visualizer
- tiny game
- product demo
- repair manual
- public data report
- checklist with local state

Weak V1 examples:

- chat app
- full SaaS client
- package manager
- shell automation
- anything requiring broad filesystem access
- anything requiring background execution

## Project Layout

Recommended source folder:

```text
my-capsule/
  capsule.json
  content/
    index.html
    app.js
    style.css
  assets/
  source/
    README.md
```

Pack it:

```bash
capsule pack ./my-capsule
```

Inspect it:

```bash
capsule inspect ./my-capsule.capsule
```

Run it:

```bash
capsule run ./my-capsule.capsule
```

## Authoring Rules

1. Work offline by default.
2. Request no capabilities unless needed.
3. Keep reasons human-readable.
4. Prefer user-picked import/export over persistent access.
5. Store only capsule-owned data.
6. Keep the UI honest about what data is used.
7. Bundle source notes when possible.
8. Treat signing as part of publishing.
9. Keep capsules small.
10. Test in safe mode.

## Permission Examples

No permissions:

```json
{
  "permissions": [],
  "network": {
    "default": "deny",
    "allow": []
  }
}
```

Local state only:

```json
{
  "permissions": [
    {
      "capability": "storage.local",
      "scope": "capsule",
      "reason": "Save your progress locally"
    }
  ]
}
```

Export only:

```json
{
  "permissions": [
    {
      "capability": "filesystem.export",
      "scope": "user-picked-location",
      "reason": "Export the finished poster"
    }
  ]
}
```

Network allowlist:

```json
{
  "permissions": [
    {
      "capability": "network.fetch",
      "scope": ["api.weather.gov"],
      "reason": "Fetch weather forecast data"
    }
  ],
  "network": {
    "default": "deny",
    "allow": ["api.weather.gov"]
  }
}
```

## Bad Permission Reasons

Bad:

```text
Required for functionality.
```

Good:

```text
Fetch current forecast data from api.weather.gov.
```

Bad:

```text
Access files.
```

Good:

```text
Import the CSV file you choose so the chart can be generated locally.
```

## UI Guidance

Capsule content should not imitate runtime permission prompts.

Do:

- explain document-specific actions
- use clear export/import buttons
- show when data stays local
- show when remote data is fetched

Do not:

- fake OS dialogs
- ask users to paste secrets
- instruct users to run shell commands
- hide network behavior
- claim privacy that the manifest does not enforce

## Publishing Checklist

Before sharing:

- `capsule inspect` passes
- `capsule verify` passes
- no undeclared network use
- no broken asset paths
- no oversized unused assets
- all permission reasons are specific
- safe mode preview looks correct
- source notes are included
- signature is attached if publishing publicly

## Example README Text

```text
This capsule works offline and stores data only inside its own isolated capsule storage.
It cannot read your files, use the network, or run shell commands.
```

