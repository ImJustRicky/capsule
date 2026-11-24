import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { embedCapsuleInHtml } from "@capsule/core";

/**
 * Node entry point for @capsule/web: gives tools (the CLI) the built viewer
 * so they can produce self-opening `.capsule.html` files.
 */

/** Absolute path of the built single-file viewer (dist/viewer.html). */
export function viewerHtmlPath(): string {
  return fileURLToPath(new URL("./viewer.html", import.meta.url));
}

export async function readViewerTemplate(): Promise<string> {
  try {
    return await readFile(viewerHtmlPath(), "utf8");
  } catch (err) {
    throw new Error(
      `capsule viewer is not built (${viewerHtmlPath()}); run \`pnpm -r build\` first: ${(err as Error).message}`,
    );
  }
}

/** Wrap raw `.capsule` bytes in the viewer to make a self-opening HTML file. */
export async function buildSelfOpeningHtml(capsuleBytes: Uint8Array, title: string): Promise<string> {
  return embedCapsuleInHtml(await readViewerTemplate(), capsuleBytes, title);
}
