# Releasing Capsule

This doc explains how to cut a release, what gets signed, and how end users
can verify the downloads they grab from the
[GitHub Releases page](https://github.com/ImJustRicky/capsule/releases).

## Cut a release

```bash
# 1. bump the version in packages/capsule-cli/package.json (and others)
# 2. commit, tag, push:
git tag v0.1.0
git push --tags
```

The `Release` workflow ([`release.yml`](../.github/workflows/release.yml))
fires automatically on any `v*.*.*` tag. It builds, signs (if configured),
and publishes:

| Artifact | Platform | Built by |
| --- | --- | --- |
| `Capsule-<v>.dmg` | macOS | `installers/macos/build.sh` → `installers/macos/dmg.sh` |
| `capsule-<v>-linux.tar.gz` | Linux | `release.yml` linux job |
| `capsule-<v>-windows.zip` | Windows | `release.yml` windows job |
| `SHA256SUMS.txt` | all | release job |
| `*.minisig` | all (optional) | release.yml when minisign secret set |

## Signing model

Capsule uses **two independent layers** of signing:

1. **OS-native code signing** so end users don't see scary warnings when they
   double-click an installer:
   - macOS: Apple Developer ID + notarization (Gatekeeper)
   - Windows: Authenticode certificate (SmartScreen)
2. **Detached, OS-independent signatures** with [minisign](https://jedisct1.github.io/minisign/)
   so anyone can verify they got the exact bytes the maintainer published,
   without trusting Apple, Microsoft, or GitHub.

OS signing requires paid certs. Minisign requires nothing — generate a key
once, publish the public half in this repo, sign every release with the
private half. **Do both** for shipping releases; **either** alone is better
than nothing.

## Required GitHub secrets

All are **optional**. Missing secrets just skip the corresponding signing
step — the workflow still produces unsigned artifacts.

### macOS (Apple)

| Secret | What it is |
| --- | --- |
| `APPLE_CERT_P12` | Base64 of your `Developer ID Application` certificate `.p12`, exported from Keychain Access |
| `APPLE_CERT_PASSWORD` | The password you set when exporting the `.p12` |
| `APPLE_DEVELOPER_ID` | Your Developer ID identity, e.g. `Developer ID Application: Jane Doe (TEAMID1234)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_TEAM_ID` | The 10-character team ID from your Apple developer account |
| `APPLE_APP_PASSWORD` | An app-specific password for `notarytool`, generated at appleid.apple.com |

To produce `APPLE_CERT_P12`:

```bash
# In Keychain Access, export your "Developer ID Application: …" cert as a .p12,
# then base64-encode it (single line) for the GitHub secret value:
base64 -i Developer-ID.p12 | pbcopy
```

### Windows (Authenticode)

| Secret | What it is |
| --- | --- |
| `WINDOWS_CERT_P12` | Base64 of your code-signing `.pfx` |
| `WINDOWS_CERT_PASSWORD` | The PFX password |

A self-signed Authenticode cert avoids SmartScreen warnings only after
extensive reputation building; for real shipping use a cert from
DigiCert/Sectigo/SSL.com.

### Minisign (recommended for everyone)

```bash
# 1. Generate a key pair locally:
minisign -G -p capsule-minisign.pub -s capsule-minisign.key

# 2. Commit the .pub to the repo:
mv capsule-minisign.pub docs/keys/
git add docs/keys/capsule-minisign.pub
git commit -m "Publish minisign release-signing public key"

# 3. Set GitHub secrets:
#      MINISIGN_SECRET_KEY  =  <contents of capsule-minisign.key>
#      MINISIGN_PASSWORD    =  <the password you used at -G>
```

Anyone who pulls a release can then verify with:

```bash
minisign -V -p docs/keys/capsule-minisign.pub \
         -m Capsule-0.1.0.dmg
```

## Verifying a download (end user instructions)

1. **Checksum.** Compare the published `SHA256SUMS.txt` line for your
   download with what you compute locally:

   ```bash
   shasum -a 256 Capsule-0.1.0.dmg
   ```

2. **Public-key signature.** If a `.minisig` exists alongside your file,
   verify it against this repo's public key:

   ```bash
   minisign -V -p capsule-minisign.pub -m Capsule-0.1.0.dmg
   ```

3. **OS verification.**
   - macOS: `spctl -a -t exec -vv /Applications/Capsule.app` should report
     "accepted" with the Developer ID. `xcrun stapler validate Capsule.dmg`
     should report a stapled notarization ticket.
   - Windows: right-click the `.zip` → Properties → Digital Signatures
     should list a valid signature with a verified timestamp.

If any of those fail, the file was modified after release. Don't run it —
report it on the issue tracker.

## What is *not* signed

- The contents of individual `.capsule` files. Capsule capsules can be
  signed with their own author keys ([`SIGNING-AND-INTEGRITY.md`](SIGNING-AND-INTEGRITY.md))
  — that signature is independent of the runtime release signature.
- Source-only installs (`pnpm install && pnpm -r build`). If you ran the
  build yourself you already know what you ran.
