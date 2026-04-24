# Release-signing public keys

This folder holds the public halves of the keys the project uses to sign
distributed installers. Commit **only public keys** here. Secret keys belong
in GitHub Actions secrets, never in the repo.

## Minisign

Replace `capsule-minisign.pub` with your own public key generated via
`minisign -G` (see `docs/RELEASE.md`).

Verifying a release artifact:

```bash
minisign -V -p docs/keys/capsule-minisign.pub -m Capsule-<version>.dmg
```

## Apple Developer ID / Windows Authenticode

These are OS-managed; there is no public key to commit. Verification happens
through Gatekeeper (macOS) and SmartScreen (Windows) automatically when a
user opens the installer.
