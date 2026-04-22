# Capability Model

## Overview

Capsules do not receive ambient authority.

They request narrow capabilities in `capsule.json`. The runtime decides which capabilities are available and asks the user or local policy engine before granting them.

## Capability Lifecycle

1. Author declares requested capability.
2. Runtime validates the manifest.
3. Runtime displays requested capabilities before execution.
4. User or policy grants, denies, or grants once.
5. Runtime exposes only granted APIs.
6. Runtime records security-relevant use as receipts.
7. User can revoke grants later.

## Capability Request Shape

```json
{
  "capability": "filesystem.export",
  "scope": "user-picked-location",
  "reason": "Export poster as PNG",
  "required": false
}
```

Fields:

- `capability`: machine-readable capability name
- `scope`: narrow resource boundary
- `reason`: human-readable explanation
- `required`: whether the capsule cannot function without it

## V1 Capabilities

### `storage.local`

Allows the capsule to store private state in its own isolated namespace.

Allowed:

- preferences
- saved document state
- local-only history

Denied:

- reading other capsules' data
- reading browser storage
- reading arbitrary local files

Scope:

```json
"capsule"
```

### `filesystem.import`

Allows user-picked file import.

Rules:

- runtime opens native file picker
- capsule receives only selected file data
- capsule does not receive the parent folder path by default
- repeated access requires repeated user selection unless user grants persistent file handle support in a future version

Scope examples:

```json
"user-picked-file"
[".csv", ".json"]
```

### `filesystem.export`

Allows user-picked export.

Rules:

- runtime opens save dialog
- capsule proposes filename and content type
- user chooses final location
- capsule cannot overwrite hidden paths without explicit user choice

Scope:

```json
"user-picked-location"
```

### `clipboard.write`

Allows writing text or image data to the clipboard.

Rules:

- clipboard writes should require a user gesture
- runtime may show a toast or receipt
- clipboard read is not included

Scope examples:

```json
"text"
"image/png"
```

### `network.fetch`

Allows outbound fetch to allowlisted hosts.

Rules:

- network default is deny
- hosts must be declared in `network.allow`
- runtime enforces host allowlist
- runtime blocks redirects to undeclared hosts unless policy says otherwise
- runtime should show network grants clearly

Scope example:

```json
["api.weather.gov"]
```

### `dialog.open`

Allows host-mediated dialogs.

Rules:

- runtime controls dialog UI
- capsule can request prompts, confirmations, alerts, and select menus
- runtime may rate-limit dialogs

Scope examples:

```json
"confirm"
["confirm", "prompt", "select"]
```

## Denied V1 Capabilities

V1 intentionally does not define:

- `shell.execute`
- `filesystem.read-path`
- `filesystem.write-path`
- `clipboard.read`
- `camera`
- `microphone`
- `location`
- `background.run`
- `notifications.push`
- `process.spawn`
- `native.plugin`
- `local-network.scan`

If these ever exist, they should be introduced under new explicit names with strong user-facing warnings.

## Grant Types

Recommended runtime grant types:

- **deny**: capability unavailable
- **allow once**: valid only for current run
- **allow this version**: valid for this content hash
- **always allow this author**: advanced mode only, signature required

Runtimes SHOULD default to allow-once for sensitive capabilities.

## Permission UI Copy

Runtimes should state permissions as verbs users understand.

Good:

```text
This capsule can export files only after you choose a save location.
```

Bad:

```text
This capsule requests filesystem.export.
```

## Capability Bridge

Capsule content talks to the runtime through a host bridge.

Example JavaScript shape:

```js
await capsule.storage.set("scenario", data);
const file = await capsule.files.import({ accept: [".csv"] });
await capsule.files.export({
  suggestedName: "poster.png",
  mimeType: "image/png",
  bytes
});
```

The bridge MUST check grants on every call. Manifest declaration alone is not a grant.

