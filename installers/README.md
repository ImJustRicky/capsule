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

## First launch from an unsigned release

Until a signed release is cut (see [`docs/RELEASE.md`](../docs/RELEASE.md)),
every OS will challenge the download on first use.

### macOS

Gatekeeper silently blocks unsigned downloaded apps. After copying to
`/Applications`, strip the quarantine attribute:

```bash
sudo xattr -dr com.apple.quarantine /Applications/Capsule.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f /Applications/Capsule.app
```

Or do it the GUI way: right-click `Capsule.app` → **Open** → **Open**.

If `.capsule` files are still opening with a different app (e.g. Archive
Utility), force the default handler:

```bash
brew install duti   # one-time
duti -s dev.capsule.runtime org.capsule.capsule all
```

### Windows

SmartScreen shows *"Windows protected your PC"* on first run of the
installer. Click **More info → Run anyway**. If PowerShell refuses the
script, use `-ExecutionPolicy Bypass`:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

### Linux

No signing-related friction. If `xdg-mime` didn't set Capsule as the
default opener, run it manually:

```bash
xdg-mime default capsule.desktop application/vnd.capsule+zip
```

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
