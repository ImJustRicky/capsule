# Contributing to Capsule

Thanks for your interest. Capsule is an open format and a reference runtime; contributions to both are welcome.

## Principles

1. **Security is the product.** A capability that feels minor can still be a full exploit primitive. If a change alters the capability model, the CSP, the archive validator, the sandbox, or the bridge protocol, call that out explicitly in the PR description.
2. **The standard is implementable by more than one runtime.** Don't encode runtime-specific assumptions into `capsule-core` or the docs.
3. **Inspection before execution.** Any change that makes a capsule harder to inspect, or easier to run without inspection, needs strong justification.
4. **Deny by default.** New capabilities must be denied unless both the manifest requests them and the user grants them.

## Setup

```bash
pnpm install
pnpm -r build
pnpm -r test
```

Node 20+ and pnpm 9+.

## PR checklist

- [ ] `pnpm -r build` succeeds
- [ ] `pnpm -r typecheck` succeeds
- [ ] `pnpm -r test` passes
- [ ] Docs in `docs/` updated if format behavior changed
- [ ] New capabilities have both runtime enforcement **and** a test that proves denial by default
- [ ] No new runtime dependencies on `capsule-core` without discussion (core is meant to be small and portable)

## Reporting a security issue

Please don't open a public issue for vulnerabilities in the sandbox, bridge, CSP, or archive validator. Email the maintainer directly. A coordinated fix matters more than speed for this project.
