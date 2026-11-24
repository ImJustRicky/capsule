/**
 * Browser-safe subset of @capsule/core.
 *
 * Everything exported here is free of Node.js APIs, so the browser viewer
 * (@capsule/web) shares the exact same path rules, hash serialization,
 * semantic manifest checks, and self-opening wrapper format as the Node
 * reference implementation instead of re-implementing them.
 */
export * from "./errors.js";
export * from "./paths.js";
export * from "./canonical.js";
export * from "./manifest-checks.js";
export * from "./embedded.js";
export type { CapabilityName, PermissionRequest, CapsuleManifest } from "./manifest-types.js";
