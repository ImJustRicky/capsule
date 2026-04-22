import { promises as fs } from "node:fs";
import path from "node:path";

export async function create(argv: string[]): Promise<number> {
  const [slug] = argv;
  if (!slug) {
    process.stderr.write("usage: capsule create <slug>\n");
    return 2;
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) {
    process.stderr.write(`invalid slug: ${slug}\n`);
    return 1;
  }

  const dir = path.resolve(slug);
  const exists = await fs.stat(dir).catch(() => null);
  if (exists) {
    process.stderr.write(`directory already exists: ${slug}\n`);
    return 1;
  }
  await fs.mkdir(path.join(dir, "content"), { recursive: true });

  const manifest = {
    capsule_version: "1.0",
    name: toTitle(slug),
    slug,
    version: "0.1.0",
    description: "A new capsule.",
    entry: "content/index.html",
    permissions: [],
    network: { default: "deny", allow: [] },
  };
  await fs.writeFile(
    path.join(dir, "capsule.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  await fs.writeFile(path.join(dir, "content", "index.html"), STARTER_HTML);

  process.stdout.write(`created ${slug}/\n  edit ${slug}/content/index.html, then: capsule pack ${slug}\n`);
  return 0;
}

function toTitle(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

const STARTER_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Capsule</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem; }
    </style>
  </head>
  <body>
    <h1>Hello, capsule.</h1>
    <p>Edit <code>content/index.html</code> to build your app.</p>
  </body>
</html>
`;
