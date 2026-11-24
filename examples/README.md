# Example capsules

Each directory is a reference capsule that exercises a different layer of the V1 capability model. Source lives here; `.capsule` archives are build artifacts (gitignored).

| Directory | Capabilities | Notes |
| --- | --- | --- |
| [`mortgage-calculator`](mortgage-calculator) | _none_ | Pure read-only document. Requests nothing, stores nothing, no network. |
| [`pocket-notes`](pocket-notes) | `storage.local` | Markdown notepad with live preview. Draft persists between sessions. |
| [`offline-checklist`](offline-checklist) | `storage.local` | To-do list persisted to per-capsule IndexedDB. |
| [`poster-maker`](poster-maker) | `storage.local`, `filesystem.export` | Canvas-based poster designer. Draft is saved; export writes a PNG to a user-picked location. |

## Build + run one

```bash
# from the repo root
pnpm -r build

node packages/capsule-cli/bin/capsule.mjs pack examples/offline-checklist -o offline-checklist.capsule
node packages/capsule-cli/bin/capsule.mjs inspect offline-checklist.capsule
node packages/capsule-cli/bin/capsule.mjs run offline-checklist.capsule

# or open it in any browser, nothing installed
node packages/capsule-cli/bin/capsule.mjs share offline-checklist.capsule
open offline-checklist.capsule.html   # macOS; use xdg-open on Linux, start on Windows
```

Every example is also published with the hosted viewer, at
`https://imjustricky.github.io/capsule/?src=examples/<slug>.capsule`.
