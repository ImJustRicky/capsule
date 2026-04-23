const MAP: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  wasm: "application/wasm",
  txt: "text/plain; charset=utf-8",
  ico: "image/x-icon",
  capsule: "application/vnd.capsule+zip",
};

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = path.slice(dot + 1).toLowerCase();
  return MAP[ext] ?? "application/octet-stream";
}
