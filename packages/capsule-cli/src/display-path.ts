import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Show a path relative to the working directory when it is inside it,
 * otherwise as given.
 *
 * Both sides are resolved through symlinks first. `process.cwd()` always
 * returns the real path, but paths the user types (or tools build) may go
 * through a symlink: on macOS every temp folder under `/var/...` is really
 * `/private/var/...`. Comparing them unresolved would print a long absolute
 * path for a file sitting right in the current directory.
 */
export function displayPath(filePath: string): string {
  const absolute = path.resolve(filePath);
  const rel = path.relative(realCwd(), realish(absolute));
  if (!rel) return ".";
  return rel.startsWith("..") || path.isAbsolute(rel) ? filePath : rel;
}

function realCwd(): string {
  try {
    return realpathSync(process.cwd());
  } catch {
    return process.cwd();
  }
}

/** Real path of a file that may not exist yet: resolve its directory instead. */
function realish(absolute: string): string {
  try {
    return realpathSync(absolute);
  } catch {
    try {
      return path.join(realpathSync(path.dirname(absolute)), path.basename(absolute));
    } catch {
      return absolute;
    }
  }
}
