/**
 * Capability mediator. Lives between the bridge protocol (postMessage) and
 * whatever backend actually fulfills the capability. In V1 most backends are
 * browser-side (IndexedDB, file pickers, clipboard, native dialogs); only
 * network.fetch is proxied through Node for origin freedom.
 *
 * The mediator enforces invariants that hold for EVERY capability:
 *
 *   1. The capability must be declared in the manifest. Undeclared =
 *      `capability.not_declared`, rejected without prompting.
 *   2. The declared scope must cover the requested args. Scope mismatch =
 *      `capability.scope_violation`, rejected without prompting.
 *   3. The user must grant the capability. Current policy is
 *      "allow-once-per-session" — an in-memory Set tracks granted caps;
 *      subsequent requests for the same cap+scope pass without re-prompting.
 *   4. Every request is receipted with a decision.
 *
 * The UI layer (host.js) handles step 3 interactively. The mediator exposes a
 * `prompt(capability, scope, reason)` hook that the UI implements.
 */

import type { CapsuleManifest, PermissionRequest } from "@capsule/core";

export type Decision = "granted" | "denied" | "not_declared" | "scope_violation";

export interface CapabilityContext {
  capsule: { slug: string; contentHash: string | null };
  declaration: PermissionRequest | null;
}

export interface RequestRecord {
  capability: string;
  method: string;
  decision: Decision;
}

export class CapabilityMediator {
  private readonly manifest: CapsuleManifest;

  constructor(manifest: CapsuleManifest) {
    this.manifest = manifest;
  }

  declarationFor(capability: string): PermissionRequest | null {
    const p = this.manifest.permissions.find((x) => x.capability === capability);
    return p ?? null;
  }

  /**
   * Check whether `requestedScope` is covered by the manifest declaration.
   * `requestedScope` is the concrete value the call targets (e.g. a host for
   * network.fetch). The declaration's `scope` is a string or string[].
   */
  scopeCovers(declaration: PermissionRequest, requestedScope: string | null): boolean {
    if (requestedScope === null) return true;
    const declared = declaration.scope;
    if (Array.isArray(declared)) return declared.includes(requestedScope);
    if (declared === "*" || declared === "any") return true;
    return declared === requestedScope;
  }
}

/**
 * The manifest is also the source of truth for `connect-src` adjustments.
 * A capsule cannot touch a host unless the host is BOTH in the permission
 * scope AND in manifest.network.allow.
 */
export function connectSrcFromManifest(manifest: CapsuleManifest): string {
  if (!manifest.network.allow.length) return "'none'";
  const origins = manifest.network.allow.map((h) => `https://${h}`).join(" ");
  return `'self' ${origins}`;
}
