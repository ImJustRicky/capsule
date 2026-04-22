/* Capsule-side bridge — injected into every HTML entry inside the iframe.
 *
 * Exposes `window.capsule.request(capability, method, args) → Promise`.
 * Denials surface as rejected promises with a stable `code` property.
 *
 * Design:
 *   - No global access to host APIs — only postMessage relayed to parent.
 *   - Each call gets a fresh correlation id; responses are matched back.
 *   - The capsule iframe is sandboxed without allow-same-origin, so it has a
 *     null origin. We MUST verify that messages come from `window.parent`,
 *     and we send to `window.parent` only.
 */
(function () {
  "use strict";
  if (window.capsule) return;

  const pending = new Map();
  let nextId = 1;

  window.addEventListener("message", (event) => {
    // Null-origin iframe: event.source is the only trustworthy check.
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.kind !== "capsule-response" || typeof data.id !== "string") return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) {
      entry.resolve(data.value);
    } else {
      const err = new Error(data.message || "capability denied");
      err.code = data.error || "capability.denied";
      entry.reject(err);
    }
  });

  function request(capability, method, args) {
    return new Promise((resolve, reject) => {
      const id = `c${nextId++}`;
      pending.set(id, { resolve, reject });
      window.parent.postMessage(
        { kind: "capsule-request", id, capability, method, args },
        "*",
      );
    });
  }

  window.capsule = Object.freeze({
    request,
    version: "1.0",
  });
})();
