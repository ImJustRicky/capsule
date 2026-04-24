import { spawn, type ChildProcess } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";

export interface AppWindowOptions {
  /** Preferred initial window size. Defaults to a compact Open-Screen fit. */
  width?: number;
  height?: number;
}

/** Closes the launched window (if possible) and cleans up its profile dir. */
export type WindowHandle = () => Promise<void>;

const DEFAULT_WIDTH = 880;
const DEFAULT_HEIGHT = 720;

/**
 * Launch the browser in "app mode" (chromeless window). We pass an explicit
 * --window-size so the app doesn't open at the browser's last-used dimensions,
 * which was making the Open Screen look lost in a huge empty canvas.
 *
 * A fresh --user-data-dir is used so the spawned Chrome owns the window
 * directly (instead of handing the request off to an already-running Chrome),
 * which lets us close it on shutdown.
 */
export function openInAppWindow(url: string, opts: AppWindowOptions = {}): WindowHandle {
  const plat = platform();
  const width = clamp(opts.width ?? DEFAULT_WIDTH, 420, 1600);
  const height = clamp(opts.height ?? DEFAULT_HEIGHT, 360, 1200);

  const candidates = chromeCandidates(plat);
  for (const { command, args } of candidates) {
    if (!commandExists(command)) continue;
    const profileDir = mkdtempSync(path.join(tmpdir(), "capsule-app-"));
    const extra = [
      `--app=${url}`,
      `--window-size=${width},${height}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ];
    const child = spawn(command, [...args, ...extra], { stdio: "ignore" });
    child.on("error", () => undefined);
    return makeCloser(child, profileDir);
  }
  const fallback = defaultOpen(plat, url);
  if (fallback) {
    spawn(fallback.command, fallback.args, { detached: true, stdio: "ignore" }).unref();
  }
  return async () => undefined;
}

function makeCloser(child: ChildProcess, profileDir: string): WindowHandle {
  let closed = false;
  return async () => {
    if (closed) return;
    closed = true;
    try {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
        });
        child.kill("SIGTERM");
        await Promise.race([exited, timeout(1500)]);
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    } catch {
      // best-effort
    }
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  };
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

interface Launcher {
  command: string;
  args: string[];
}

function chromeCandidates(plat: NodeJS.Platform): Launcher[] {
  if (plat === "darwin") {
    return [
      {
        command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args: [],
      },
      {
        command: "/Applications/Chromium.app/Contents/MacOS/Chromium",
        args: [],
      },
      {
        command: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        args: [],
      },
      {
        command: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        args: [],
      },
    ];
  }
  if (plat === "linux") {
    return [
      { command: "/usr/bin/google-chrome", args: [] },
      { command: "/usr/bin/chromium", args: [] },
      { command: "/usr/bin/chromium-browser", args: [] },
      { command: "/usr/bin/microsoft-edge", args: [] },
    ];
  }
  if (plat === "win32") {
    return [
      {
        command: "C:/Program Files/Google/Chrome/Application/chrome.exe",
        args: [],
      },
      {
        command: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        args: [],
      },
    ];
  }
  return [];
}

function defaultOpen(plat: NodeJS.Platform, url: string): Launcher | null {
  if (plat === "darwin") return { command: "open", args: [url] };
  if (plat === "linux") return { command: "xdg-open", args: [url] };
  if (plat === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return null;
}

function commandExists(cmd: string): boolean {
  try {
    accessSync(cmd, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
