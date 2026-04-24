import { runCapsule } from "@capsule/runtime";

export async function run(argv: string[]): Promise<number> {
  const { file, headless, port } = parseArgs(argv);
  if (!file) {
    process.stderr.write("usage: capsule run <file.capsule> [--port N] [--headless]\n");
    return 2;
  }

  const opts: { headless?: boolean; port?: number } = {};
  if (headless) opts.headless = true;
  if (port !== undefined) opts.port = port;

  const { server, closeWindow } = await runCapsule(file, opts);
  process.stdout.write(`capsule running at ${server.url}\n`);
  process.stdout.write("press Ctrl+C to stop\n");

  return await new Promise<number>((resolve) => {
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      Promise.allSettled([closeWindow(), server.close()]).then(() => resolve(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

interface RunArgs {
  file: string | undefined;
  headless: boolean;
  port: number | undefined;
}

function parseArgs(argv: string[]): RunArgs {
  let file: string | undefined;
  let headless = false;
  let port: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--headless") headless = true;
    else if (a === "--port") port = Number(argv[++i]);
    else if (!file) file = a;
  }
  return { file, headless, port };
}
