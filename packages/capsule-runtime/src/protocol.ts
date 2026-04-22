/**
 * Bridge protocol between the capsule (iframe) and the host page.
 *
 * Every message crosses a postMessage boundary. The host page is the ONLY
 * surface that talks to the runtime server; the capsule talks only to the
 * host. The capsule is served as a sandboxed iframe with `allow-scripts`
 * (no `allow-same-origin`), so it has a null origin and cannot read cookies,
 * localStorage, or the parent window.
 *
 * All capability calls return an envelope. A denial is NOT an exception at
 * the protocol level — the capsule must handle "denied" gracefully.
 */

export type CapabilityName =
  | "storage.local"
  | "filesystem.import"
  | "filesystem.export"
  | "clipboard.write"
  | "network.fetch"
  | "dialog.open";

export interface CapsuleRequest {
  /** Protocol marker; rejected if missing. */
  kind: "capsule-request";
  /** Correlation id assigned by the capsule. */
  id: string;
  capability: CapabilityName;
  method: string;
  args?: unknown;
}

export interface CapsuleResponseOk {
  kind: "capsule-response";
  id: string;
  ok: true;
  value: unknown;
}

export interface CapsuleResponseErr {
  kind: "capsule-response";
  id: string;
  ok: false;
  /** Stable error code. `capability.denied` is the default in V1. */
  error: string;
  message: string;
}

export type CapsuleResponse = CapsuleResponseOk | CapsuleResponseErr;

export interface HostReady {
  kind: "host-ready";
}

export function isCapsuleRequest(v: unknown): v is CapsuleRequest {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "capsule-request" &&
    typeof r.id === "string" &&
    typeof r.capability === "string" &&
    typeof r.method === "string"
  );
}
