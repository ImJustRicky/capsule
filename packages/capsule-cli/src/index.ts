import { CapsuleError } from "@capsule/core";
import { inspect } from "./commands/inspect.js";
import { pack } from "./commands/pack.js";
import { create } from "./commands/create.js";
import { verify } from "./commands/verify.js";
import { run as runCmd } from "./commands/run.js";
import { receipts } from "./commands/receipts.js";

const USAGE = `capsule — reference CLI for the Capsule 1.0 format

Usage:
  capsule create <slug>             scaffold a new capsule project directory
  capsule pack <dir> [-o <out>]     pack a directory into <dir>.capsule
  capsule inspect <file.capsule>    print manifest, files, integrity
  capsule verify <file.capsule>     verify declared content_hash
  capsule run <file.capsule>        open a capsule in a sandboxed runtime
  capsule receipts [--limit N]      print recent runtime receipts
  capsule help                      show this message
`;

export async function run(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "-h":
      case "--help":
        process.stdout.write(USAGE);
        return 0;
      case "inspect":
        return await inspect(rest);
      case "pack":
        return await pack(rest);
      case "create":
        return await create(rest);
      case "verify":
        return await verify(rest);
      case "run":
        return await runCmd(rest);
      case "receipts":
        return await receipts(rest);
      default:
        process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}`);
        return 2;
    }
  } catch (err: unknown) {
    if (err instanceof CapsuleError) {
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}
