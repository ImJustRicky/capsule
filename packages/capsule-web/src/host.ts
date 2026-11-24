import { base64ToBytes, bytesToBase64, type CapsuleManifest } from "@capsule/core/browser";
import {
  CapabilityError,
  checkFetchTarget,
  declarationFor,
  extractScope,
  normalizeFetchMethod,
  sanitizeRequestHeaders,
  scopeCovers,
} from "./capabilities.js";

/**
 * Browser capability host: the mediator between the sandboxed capsule frame
 * and the browser APIs that fulfil each capability. Same pipeline as the
 * Node runtime's host.js: declared → scoped → user decision → dispatch →
 * receipt. Decisions are remembered for this page session only.
 */

export interface CapsuleRequest {
  kind: "capsule-request";
  id: string;
  capability: string;
  method: string;
  args?: unknown;
}

export type CapsuleReply =
  | { ok: true; value: unknown }
  | { ok: false; error: string; message: string };

export interface ReceiptRecord {
  ts: string;
  event: string;
  capability?: string;
  method?: string;
  scope?: string | null;
  detail?: string;
}

export interface HostUi {
  /** Ask the user to allow a capability. Resolves "granted" or "denied". */
  promptPermission(capability: string, scope: string | null, reason: string): Promise<"granted" | "denied">;
  /**
   * Get a fresh user gesture for APIs that require one (file pickers,
   * clipboard). Resolves false if the user cancels.
   */
  requestGesture(message: string, actionLabel: string): Promise<boolean>;
  alert(message: string): void;
  confirm(message: string): boolean;
  prompt(message: string, defaultValue: string): string | null;
  /** Non-blocking notice (e.g. storage fell back to memory). */
  notify(message: string): void;
}

export function isCapsuleRequest(value: unknown): value is CapsuleRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return r.kind === "capsule-request" && typeof r.id === "string";
}

const MAX_FETCH_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_STORAGE_VALUE_BYTES = 5 * 1024 * 1024;

export class CapabilityHost {
  readonly receipts: ReceiptRecord[] = [];
  private readonly decisions = new Map<string, "granted" | "denied">();
  private readonly storage: KeyValueStore;

  constructor(
    private readonly manifest: CapsuleManifest,
    contentHash: string,
    private readonly ui: HostUi,
  ) {
    this.storage = new KeyValueStore(`${manifest.slug}@${contentHash}`, () =>
      ui.notify("Storage is temporary in this browser: saved data will be lost when you close the tab."),
    );
  }

  record(event: string, extra: Omit<ReceiptRecord, "ts" | "event"> = {}): void {
    this.receipts.push({ ts: new Date().toISOString(), event, ...extra });
    if (this.receipts.length > 500) this.receipts.shift();
  }

  async handle(req: CapsuleRequest): Promise<CapsuleReply> {
    const { capability, method, args } = req;
    if (typeof capability !== "string" || typeof method !== "string") {
      return { ok: false, error: "request.invalid", message: "capability and method must be strings" };
    }

    const declaration = declarationFor(this.manifest, capability);
    if (!declaration) {
      return this.fail("capability.not_declared", `${capability} is not declared in the manifest`, capability, method);
    }

    const scope = extractScope(capability, args);
    if (!scopeCovers(declaration.scope, scope)) {
      return this.fail(
        "capability.scope_violation",
        `${capability} scope does not cover ${JSON.stringify(scope)}`,
        capability,
        method,
        scope,
      );
    }

    const key = `${capability}\0${JSON.stringify(scope)}`;
    let decision = this.decisions.get(key);
    if (!decision) {
      decision = await this.ui.promptPermission(capability, scope, declaration.reason);
      this.decisions.set(key, decision);
    }
    if (decision !== "granted") {
      return this.fail("capability.denied", "user denied this capability", capability, method, scope);
    }

    try {
      const value = await this.dispatch(capability, method, args);
      this.record("grant", { capability, method, scope });
      return { ok: true, value };
    } catch (err) {
      const code = err instanceof CapabilityError ? err.code : "capability.error";
      const message = err instanceof Error ? err.message : String(err);
      this.record("deny", { capability, method, scope, detail: `${code}: ${message}` });
      return { ok: false, error: code, message };
    }
  }

  private fail(
    code: string,
    message: string,
    capability: string,
    method: string,
    scope: string | null = null,
  ): CapsuleReply {
    this.record("deny", { capability, method, scope, detail: code });
    return { ok: false, error: code, message };
  }

  private dispatch(capability: string, method: string, args: unknown): Promise<unknown> | unknown {
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    switch (capability) {
      case "storage.local":
        return this.storageLocal(method, a);
      case "dialog.open":
        return this.dialogOpen(method, a);
      case "clipboard.write":
        return this.clipboardWrite(method, a);
      case "filesystem.import":
        return this.filesystemImport(method, a);
      case "filesystem.export":
        return this.filesystemExport(method, a);
      case "network.fetch":
        return this.networkFetch(method, a);
      default:
        throw new CapabilityError("capability.unknown", `unknown capability ${capability}`);
    }
  }

  // -- storage.local --------------------------------------------------

  private async storageLocal(method: string, a: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "get":
        return (await this.storage.get(String(a.key))) ?? null;
      case "set": {
        const value = a.value ?? null;
        if (approximateSize(value) > MAX_STORAGE_VALUE_BYTES) {
          throw new CapabilityError("storage.quota", "value is larger than 5 MB");
        }
        await this.storage.set(String(a.key), value);
        return true;
      }
      case "delete":
        await this.storage.delete(String(a.key));
        return true;
      case "keys":
        return this.storage.keys();
      default:
        throw new CapabilityError("method.unknown", `storage.local.${method} is not supported`);
    }
  }

  // -- dialog.open ----------------------------------------------------

  private dialogOpen(method: string, a: Record<string, unknown>): unknown {
    const message = `${this.manifest.name}\n\n${String(a.message ?? "")}`;
    switch (method) {
      case "alert":
        this.ui.alert(message);
        return true;
      case "confirm":
        return this.ui.confirm(message);
      case "prompt":
        return this.ui.prompt(message, a.default === undefined ? "" : String(a.default));
      default:
        throw new CapabilityError("method.unknown", `dialog.open.${method} is not supported`);
    }
  }

  // -- clipboard.write ------------------------------------------------

  private async clipboardWrite(method: string, a: Record<string, unknown>): Promise<unknown> {
    if (method !== "text") {
      throw new CapabilityError("method.unknown", `clipboard.write.${method} is not supported`);
    }
    if (!navigator.clipboard?.writeText) {
      throw new CapabilityError("capability.unavailable", "clipboard API not available in this browser");
    }
    const text = String(a.text ?? "");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Most browsers require a recent user gesture; get one and retry once.
      if (!(await this.ui.requestGesture(`${this.manifest.name} wants to copy text to your clipboard.`, "Copy"))) {
        throw new CapabilityError("capability.cancelled", "user cancelled");
      }
      await navigator.clipboard.writeText(text);
    }
    return true;
  }

  // -- filesystem.import / export -------------------------------------

  private async filesystemImport(method: string, a: Record<string, unknown>): Promise<unknown> {
    if (method !== "pick") {
      throw new CapabilityError("method.unknown", `filesystem.import.${method} is not supported`);
    }
    if (!hasUserActivation()) {
      if (!(await this.ui.requestGesture(`${this.manifest.name} wants you to choose a file to open.`, "Choose file…"))) {
        return a.multiple ? [] : null;
      }
    }
    const files = await pickFiles(a.accept === undefined ? "" : String(a.accept), Boolean(a.multiple));
    const out = await Promise.all(
      files.map(async (f) => ({
        name: f.name,
        type: f.type,
        size: f.size,
        bytes_b64: bytesToBase64(new Uint8Array(await f.arrayBuffer())),
      })),
    );
    return a.multiple ? out : (out[0] ?? null);
  }

  private async filesystemExport(method: string, a: Record<string, unknown>): Promise<unknown> {
    if (method !== "save") {
      throw new CapabilityError("method.unknown", `filesystem.export.${method} is not supported`);
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(String(a.bytes_b64 ?? ""));
    } catch {
      throw new CapabilityError("filesystem.invalid", "bytes_b64 is not valid base64");
    }
    const name = sanitizeFileName(String(a.suggested_name ?? "download"));
    const type = String(a.type ?? "application/octet-stream");
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });

    const picker = (window as unknown as {
      showSaveFilePicker?: (o: { suggestedName: string }) => Promise<{
        name?: string;
        createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>;
      }>;
    }).showSaveFilePicker;
    if (picker) {
      if (!hasUserActivation()) {
        if (!(await this.ui.requestGesture(`${this.manifest.name} wants to save “${name}”.`, "Save…"))) {
          return { saved: false };
        }
      }
      try {
        const handle = await picker({ suggestedName: name });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { saved: true, name: handle.name ?? name };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return { saved: false };
        throw err;
      }
    }

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { saved: true, name };
  }

  // -- network.fetch --------------------------------------------------

  /**
   * Direct fetch from the viewer (there is no proxy in a browser), so the
   * target must allow CORS. Same response envelope as the Node proxy.
   * Redirects are refused: the browser cannot re-check each hop.
   */
  private async networkFetch(method: string, a: Record<string, unknown>): Promise<unknown> {
    if (method !== "request") {
      throw new CapabilityError("method.unknown", `network.fetch.${method} is not supported`);
    }
    const target = checkFetchTarget(this.manifest, a.url);
    const httpMethod = normalizeFetchMethod(a.method);
    if ((httpMethod === "GET" || httpMethod === "HEAD") && a.body !== undefined) {
      throw new CapabilityError("network.invalid_request", `${httpMethod} requests cannot include a body`);
    }
    if (a.body !== undefined && typeof a.body !== "string") {
      throw new CapabilityError("network.invalid_request", "body must be a string");
    }
    const init: RequestInit = {
      method: httpMethod,
      headers: sanitizeRequestHeaders(a.headers),
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      mode: "cors",
    };
    if (typeof a.body === "string") init.body = a.body;

    let response: Response;
    try {
      response = await fetch(target.toString(), init);
    } catch (err) {
      throw new CapabilityError(
        "network.error",
        `request failed (the host must allow CORS, and redirects are not followed): ${(err as Error).message}`,
      );
    }
    const body = await readLimited(response, MAX_FETCH_RESPONSE_BYTES);
    return {
      status: response.status,
      ok: response.ok,
      headers: { "content-type": response.headers.get("content-type") ?? "application/octet-stream" },
      body_b64: bytesToBase64(body),
    };
  }
}

// ---------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------

/**
 * Capsule-private key/value store. IndexedDB when the browser allows it
 * (keys are namespaced by slug@content-hash, like the Node runtime), with an
 * in-memory fallback for browsers that block storage on file:// pages.
 */
class KeyValueStore {
  private db: Promise<IDBDatabase | null> | null = null;
  private readonly memory = new Map<string, unknown>();
  private warned = false;

  constructor(private readonly namespace: string, private readonly onFallback: () => void) {}

  private open(): Promise<IDBDatabase | null> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase | null>((resolve) => {
        try {
          const req = indexedDB.open("capsule:storage", 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("kv")) req.result.createObjectStore("kv");
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch {
          resolve(null);
        }
      }).then((db) => {
        if (!db && !this.warned) {
          this.warned = true;
          this.onFallback();
        }
        return db;
      });
    }
    return this.db as Promise<IDBDatabase | null>;
  }

  private key(k: string): string {
    return `${this.namespace}\0${k}`;
  }

  private async run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    if (!db) throw new Error("no indexeddb");
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("kv", mode);
      const req = op(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get(k: string): Promise<unknown> {
    if (!(await this.open())) return this.memory.get(k);
    return this.run("readonly", (s) => s.get(this.key(k)));
  }

  async set(k: string, value: unknown): Promise<void> {
    if (!(await this.open())) {
      this.memory.set(k, structuredClone(value));
      return;
    }
    await this.run("readwrite", (s) => s.put(value, this.key(k)));
  }

  async delete(k: string): Promise<void> {
    if (!(await this.open())) {
      this.memory.delete(k);
      return;
    }
    await this.run("readwrite", (s) => s.delete(this.key(k)));
  }

  async keys(): Promise<string[]> {
    if (!(await this.open())) return [...this.memory.keys()];
    const prefix = `${this.namespace}\0`;
    // Bounded key-range scan: only this capsule's keys are read.
    const all = await this.run("readonly", (s) =>
      s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}￿`)),
    );
    return all
      .filter((k): k is string => typeof k === "string" && k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}

function hasUserActivation(): boolean {
  const ua = (navigator as unknown as { userActivation?: { isActive: boolean } }).userActivation;
  // Browsers without the API: assume yes and let the picker decide.
  return ua ? ua.isActive : true;
}

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    document.body.appendChild(input);
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener("cancel", () => finish([]), { once: true });
    input.click();
  });
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim();
  return cleaned.slice(0, 200) || "download";
}

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new CapabilityError("network.too_large", "response is larger than 25 MB");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function approximateSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}
