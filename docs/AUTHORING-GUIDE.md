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

Fastest path:

```bash
capsule make my-checklist --template checklist
capsule make ./site --name "Interactive Field Guide"
```

`capsule make` is the friendly path. It can create a starter project, package a
plain folder with `index.html`, or package a full Capsule project.

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

Use `capsule pack` when you want the lower-level deterministic packer and you
already have `capsule.json`.

Inspect it:

```bash
capsule inspect ./my-capsule.capsule
```

Run it:

```bash
capsule run ./my-capsule.capsule
```

## From an AI Tool

Most AI tools produce a single HTML file with inline styles and scripts. That is already a valid capsule entry:

```bash
capsule make my-app.html --html
```

This writes `my-app.capsule` and a self-opening `my-app.capsule.html`, and takes the display name from the page's `<title>`. Inline `<script>` and `on*` handlers are allowed; see [SECURITY-MODEL.md](./SECURITY-MODEL.md#content-security-policy) for why that is safe.

What to check before sharing:

- **Remove CDN links.** `<script src="https://cdn…">`, web fonts, and remote images are blocked by the sandbox. Inline the library, or ask the AI tool for a version with no external dependencies.
- **No `fetch()` of your own files.** Capsule content cannot make network requests, including to files inside the capsule. Inline small data as a JS object instead.
- **No `localStorage`.** The sandbox blocks it. Use `window.capsule.request("storage.local", "get" | "set", …)` and declare `storage.local` in `capsule.json`.
- **No `eval` or `new Function`.** Both are blocked in every runtime.

A prompt that tends to produce capsule-ready output:

```text
Make this as a single self-contained HTML file: no external scripts, fonts,
images, or network requests, no localStorage, no eval. Inline all CSS and JS.
```

## Works Everywhere

Capsules run in two reference runtimes: the Node runtime (`capsule run`) and the zero-install browser viewer. A capsule that follows these rules behaves the same in both:

- Reference assets from HTML or CSS (`<img src>`, `url()`), not by building URLs in JavaScript. The browser viewer inlines declarative references only.
- Bundle ES modules into one file. Relative `import`s between files don't resolve in the browser viewer.
- Don't ship your own CSP `<meta>`; the runtime provides one.
- For `network.fetch`, prefer APIs that send CORS headers. The browser viewer fetches directly; only the Node runtime proxies.

Details: [WEB-VIEWER.md](./WEB-VIEWER.md#limits).

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
- it runs in the browser viewer, not just `capsule run` (open the `.capsule.html`)
- no undeclared network use
- no external scripts, fonts, or images
- no broken asset paths
- no oversized unused assets
- all permission reasons are specific
- safe mode preview looks correct
- source notes are included
- signature is attached if publishing publicly

To send it to someone without Capsule, share the self-opening copy:

```bash
capsule share my-app.capsule      # writes my-app.capsule.html
```

## Example README Text

```text
This capsule works offline and stores data only inside its own isolated capsule storage.
It cannot read your files, use the network, or run shell commands.
```
