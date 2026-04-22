import { loadCapsuleFromFile } from "@capsule/core";
import { createSessionToken, startServer, type RunningServer } from "./server.js";
import { openInAppWindow } from "./launch.js";

export * from "./protocol.js";
export { startServer } from "./server.js";
export type { CapsuleSession, RunningServer, StartServerOptions } from "./server.js";

export interface RunCapsuleOptions {
  /** If true, do not open a browser window. */
  headless?: boolean;
  /** Explicit port (default: random). */
  port?: number;
}

export interface RunCapsuleResult {
  server: RunningServer;
  url: string;
}

export async function runCapsule(
  filePath: string,
  options: RunCapsuleOptions = {},
): Promise<RunCapsuleResult> {
  const loaded = await loadCapsuleFromFile(filePath);
  const token = createSessionToken();
  const serverOpts: { port?: number } = {};
  if (options.port !== undefined) serverOpts.port = options.port;
  const server = await startServer(
    {
      manifest: loaded.manifest,
      archive: loaded.archive,
      token,
    },
    serverOpts,
  );
  if (!options.headless) {
    const preferred = loaded.manifest.display?.preferred_size;
    const winOpts: { width?: number; height?: number } = {};
    if (preferred?.width) winOpts.width = preferred.width;
    if (preferred?.height) winOpts.height = preferred.height;
    openInAppWindow(server.url, winOpts);
  }
  return { server, url: server.url };
}
