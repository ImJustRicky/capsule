# Capsule installers

Per-platform installers that register `Capsule` as the system handler for
`.capsule` files, so users can **double-click** a capsule in their file
manager and have it open in the sandboxed runtime.

| Platform | Folder | Install command |
| --- | --- | --- |
| macOS | [`macos/`](macos) | `./installers/macos/build.sh && ./installers/macos/install.sh` |
| Linux | [`linux/`](linux) | `sudo ./installers/linux/install.sh` |
| Windows | [`windows/`](windows) | `powershell -ExecutionPolicy Bypass -File .\installers\windows\install.ps1` |

Source-checkout installers do the same three things:

1. **Build the runtime** (`pnpm -r build`).
2. **Stage** the built `dist/` of `capsule-core`, `capsule-runtime`, and
   `capsule-cli` into a per-platform location (`/Applications`, `/usr/local`,
   `%LOCALAPPDATA%`).
3. **Register the file association** with the OS so `.capsule` files are
   routed to the bundled launcher. The launcher locates Node and invokes
   `capsule run <file>`.

Release artifacts already contain the built runtime, so Linux and Windows
installers copy `runtime/` directly and do not require `pnpm`.

## Requirements

- **Node.js v20+** on the user's machine. (Bundling Node would balloon the
  installer to ~50 MB; for V1 we keep the artifact small and require Node.)
- **macOS**: Command Line Tools for `pnpm`/`npm`. Optional: `duti`
  (`brew install duti`) so the installer can force-set Capsule as the
  default opener immediately.
- **Linux**: `sudo` access to write to `/usr/local`. The installer registers
  the MIME type via `update-mime-database` and `xdg-mime`.
- **Windows**: no admin rights needed; everything is per-user under `HKCU`
  and `%LOCALAPPDATA%`.

## Uninstall

| Platform | Command |
| --- | --- |
| macOS | `./installers/macos/uninstall.sh` |
| Linux | `sudo ./installers/linux/uninstall.sh` |
| Windows | `powershell -ExecutionPolicy Bypass -File .\installers\windows\uninstall.ps1` |

## How file association works

| OS | Mechanism |
| --- | --- |
| macOS | `Info.plist` declares `CFBundleDocumentTypes` + `UTExportedTypeDeclarations` for UTI `org.capsule.capsule`. Launch Services routes `.capsule` opens to `Capsule.app`. |
| Linux | `capsule.desktop` + `share/mime/packages/capsule.xml` declare MIME `application/vnd.capsule+zip`. `xdg-mime` sets it as the default. |
| Windows | HKCU registry entries map `.capsule` → `Capsule.Document` ProgID → launcher `.cmd` with `%1` argument. |

## Distributing pre-built installers

The `Build & sign release artifacts` GitHub Actions workflow
([`.github/workflows/release.yml`](../.github/workflows/release.yml)) packages
all three platforms when you push a `v*` tag, optionally code-signs them
(macOS notarization + Windows Authenticode), and attaches them to a GitHub
Release. End users then download the installer for their OS instead of
cloning the repo.

See [`docs/RELEASE.md`](../docs/RELEASE.md) for the signing setup.
