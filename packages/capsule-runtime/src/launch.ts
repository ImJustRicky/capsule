import { spawn } from "node:child_process";
import { platform } from "node:os";
import { accessSync, constants } from "node:fs";

export interface AppWindowOptions {
  /** Preferred initial window size. Defaults to a compact Open-Screen fit. */
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 880;
const DEFAULT_HEIGHT = 720;

/**
 * Launch the browser in "app mode" (chromeless window). We pass an explicit
 * --window-size so the app doesn't open at the browser's last-used dimensions,
 * which was making the Open Screen look lost in a huge empty canvas.
 */
export function openInAppWindow(url: string, opts: AppWindowOptions = {}): void {
  const plat = platform();
  const width = clamp(opts.width ?? DEFAULT_WIDTH, 420, 1600);
  const height = clamp(opts.height ?? DEFAULT_HEIGHT, 360, 1200);
  const extra = [`--app=${url}`, `--window-size=${width},${height}`];
  const candidates = chromeCandidates(plat);
  for (const { command, args } of candidates) {
    if (!commandExists(command)) continue;
    spawn(command, [...args, ...extra], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const fallback = defaultOpen(plat, url);
  if (fallback) {
    spawn(fallback.command, fallback.args, { detached: true, stdio: "ignore" }).unref();
  }
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
