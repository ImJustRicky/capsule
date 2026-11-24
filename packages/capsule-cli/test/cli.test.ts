import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "../src/index.js";

let tmp: string;
let cwdBefore: string;
let stdout: string;
let stderr: string;
let origWrite: typeof process.stdout.write;
let origErr: typeof process.stderr.write;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-cli-"));
  cwdBefore = process.cwd();
  process.chdir(tmp);
  stdout = "";
  stderr = "";
  origWrite = process.stdout.write.bind(process.stdout);
  origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;
});

afterEach(async () => {
  process.stdout.write = origWrite;
  process.stderr.write = origErr;
  process.chdir(cwdBefore);
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("capsule CLI", () => {
  it("make from a template creates a project and a verified .capsule", async () => {
    expect(await run(["make", "field-list", "--template", "checklist"])).toBe(0);
    expect(await fs.stat(path.join(tmp, "field-list", "capsule.json"))).toBeTruthy();
    expect(await fs.stat(path.join(tmp, "field-list", "content", "index.html"))).toBeTruthy();
    expect(await fs.stat(path.join(tmp, "field-list.capsule"))).toBeTruthy();
    expect(stdout).toMatch(/made field-list\.capsule/);
    expect(stdout).toMatch(/capabilities: 1 requested/);
    expect(stdout).toMatch(/next:/);

    stdout = "";
    expect(await run(["inspect", path.join(tmp, "field-list.capsule")])).toBe(0);
    expect(stdout).toMatch(/Field List 0\.1\.0/);
    expect(stdout).toMatch(/storage\.local/);

    stdout = "";
    expect(await run(["verify", path.join(tmp, "field-list.capsule")])).toBe(0);
    expect(stdout).toMatch(/^ok {2}field-list/);
  });

  it("make packages a plain web folder by wrapping it under content/", async () => {
    const site = path.join(tmp, "tiny-site");
    await fs.mkdir(site);
    await fs.writeFile(path.join(site, "index.html"), "<!doctype html><title>Tiny</title><h1>Tiny</h1>");
    await fs.writeFile(path.join(site, "style.css"), "h1 { color: #16796f; }");

    expect(await run(["make", site, "--name", "Tiny Site"])).toBe(0);
    const capsulePath = path.join(tmp, "tiny-site.capsule");
    expect(await fs.stat(capsulePath)).toBeTruthy();

    stdout = "";
    expect(await run(["inspect", capsulePath])).toBe(0);
    expect(stdout).toMatch(/Tiny Site 0\.1\.0/);
    expect(stdout).toMatch(/entry:\s+content\/index\.html/);
    expect(stdout).toMatch(/content\/style\.css/);
  });

  it("make can list starter templates", async () => {
    expect(await run(["make", "--list-templates"])).toBe(0);
    expect(stdout).toMatch(/blank/);
    expect(stdout).toMatch(/checklist/);
    expect(stdout).toMatch(/calculator/);
  });

  it("make refuses to overwrite output unless --force is passed", async () => {
    const site = path.join(tmp, "site");
    await fs.mkdir(site);
    await fs.writeFile(path.join(site, "index.html"), "<!doctype html><title>One</title>");

    expect(await run(["make", site, "-o", "site.capsule"])).toBe(0);
    stderr = "";
    expect(await run(["make", site, "-o", "site.capsule"])).toBe(1);
    expect(stderr).toMatch(/output already exists/);

    stdout = "";
    expect(await run(["make", site, "-o", "site.capsule", "--force"])).toBe(0);
    expect(stdout).toMatch(/made site\.capsule/);
  });

  it("create → pack → inspect → verify round-trip", async () => {
    expect(await run(["create", "demo-app"])).toBe(0);
    expect(await fs.stat(path.join(tmp, "demo-app", "capsule.json"))).toBeTruthy();

    expect(await run(["pack", "demo-app"])).toBe(0);
    const capsulePath = path.join(tmp, "demo-app.capsule");
    const st = await fs.stat(capsulePath);
    expect(st.size).toBeGreaterThan(0);
    expect(stdout).toMatch(/content_hash: sha256:/);

    stdout = "";
    expect(await run(["inspect", capsulePath])).toBe(0);
    expect(stdout).toMatch(/Demo App 0\.1\.0/);
    expect(stdout).toMatch(/status:\s+ok/);
    expect(stdout).toMatch(/content\/index\.html/);

    stdout = "";
    expect(await run(["verify", capsulePath])).toBe(0);
    expect(stdout).toMatch(/^ok {2}demo-app/);
  });

  it("verify fails when declared content_hash is wrong", async () => {
    // Build a capsule with a hand-crafted wrong integrity block via the core API.
    const { packArchive } = await import("@capsule/core");
    const enc = new TextEncoder();
    const manifest = {
      capsule_version: "1.0",
      name: "Bad",
      slug: "bad-cap",
      version: "0.1.0",
      description: "tampered",
      entry: "content/index.html",
      permissions: [],
      network: { default: "deny", allow: [] },
      integrity: {
        algorithm: "sha256",
        content_hash:
          "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      },
    };
    const packed = await packArchive(
      [
        { path: "capsule.json", bytes: enc.encode(JSON.stringify(manifest)) },
        { path: "content/index.html", bytes: enc.encode("<p>hi</p>") },
      ],
      { stampIntegrity: false },
    );
    const capsulePath = path.join(tmp, "bad.capsule");
    await fs.writeFile(capsulePath, packed.bytes);

    stderr = "";
    const code = await run(["verify", capsulePath]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/content hash mismatch/);
  });

  it("pack requires the standard .capsule extension for explicit output", async () => {
    expect(await run(["create", "demo-app"])).toBe(0);
    stderr = "";
    expect(await run(["pack", "demo-app", "-o", "demo-app.zip"])).toBe(1);
    expect(stderr).toMatch(/\.capsule extension/);
  });

  it("rejects unknown commands with exit 2", async () => {
    const code = await run(["whatever"]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/unknown command/);
  });

  it("help prints usage", async () => {
    expect(await run(["help"])).toBe(0);
    expect(stdout).toMatch(/Usage:/);
    expect(stdout).toMatch(/capsule share/);
  });

  it("make names a single-file app from its <title> and keeps inline scripts", async () => {
    const page = path.join(tmp, "output.html");
    await fs.writeFile(
      page,
      "<!doctype html><title>  Tip &amp; Split\n Calculator </title><script>document.title='ran'</script>",
    );
    expect(await run(["make", page])).toBe(0);
    expect(stdout).toMatch(/made tip-split-calculator\.capsule/);
    expect(stdout).toMatch(/name:\s+Tip & Split Calculator/);
    expect(stdout).toMatch(/source:\s+output\.html/);
  });

  it("make keeps very short names recognizable instead of a generic default", async () => {
    const page = path.join(tmp, "ai.html");
    await fs.writeFile(page, "<!doctype html><p>no title</p>");
    expect(await run(["make", page])).toBe(0);
    expect(stdout).toMatch(/made ai-capsule\.capsule/);
  });

  it("make --html also writes a self-opening .capsule.html that inspects identically", async () => {
    const page = path.join(tmp, "game.html");
    await fs.writeFile(page, "<!doctype html><title>Tiny Game</title><canvas></canvas>");
    expect(await run(["make", page, "--html"])).toBe(0);
    const html = await fs.readFile(path.join(tmp, "tiny-game.capsule.html"), "utf8");
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("<title>Tiny Game · Capsule</title>");
    expect(html).toMatch(/<script id="capsule-payload" type="application\/vnd\.capsule\+zip;base64">\n[A-Za-z0-9+/=\n]+<\/script>/);

    stdout = "";
    expect(await run(["inspect", path.join(tmp, "tiny-game.capsule.html")])).toBe(0);
    expect(stdout).toMatch(/Tiny Game 0\.1\.0/);
    expect(stdout).toMatch(/wrapper:\s+self-opening/);

    stdout = "";
    expect(await run(["verify", path.join(tmp, "tiny-game.capsule.html")])).toBe(0);
    expect(stdout).toMatch(/^ok {2}tiny-game/);
  });

  it("share wraps an existing capsule and refuses to overwrite without --force", async () => {
    expect(await run(["make", "notes", "--template", "checklist"])).toBe(0);
    stdout = "";
    expect(await run(["share", path.join(tmp, "notes.capsule")])).toBe(0);
    expect(stdout).toMatch(/shared notes\.capsule\.html/);
    expect(stdout).toMatch(/nothing to install/);

    stderr = "";
    expect(await run(["share", path.join(tmp, "notes.capsule")])).toBe(1);
    expect(stderr).toMatch(/already exists/);
    expect(await run(["share", path.join(tmp, "notes.capsule"), "--force", "-o", "copy.capsule.html"])).toBe(0);
    expect(await fs.stat(path.join(tmp, "copy.capsule.html"))).toBeTruthy();
  });

  it("share refuses a tampered capsule", async () => {
    expect(await run(["make", "tamper", "--template", "blank"])).toBe(0);
    const capsulePath = path.join(tmp, "tamper.capsule");
    const bytes = await fs.readFile(capsulePath);
    // Stored entries are deflated; flip a byte inside the archive body and
    // expect either an archive error or an integrity mismatch.
    const corrupted = Buffer.from(bytes);
    corrupted[Math.floor(corrupted.length / 2)] ^= 0xff;
    await fs.writeFile(capsulePath, corrupted);
    stderr = "";
    expect(await run(["share", capsulePath])).toBe(1);
    // A clean, coded error, never a raw zlib stack trace.
    expect(stderr).toMatch(/^error \[(archive|integrity|manifest)\./);
    await expect(fs.stat(path.join(tmp, "tamper.capsule.html"))).rejects.toThrow();
  });

  it("share prints usage on bad arguments", async () => {
    expect(await run(["share"])).toBe(2);
    expect(await run(["share", "a.capsule", "--bogus"])).toBe(2);
    expect(stderr).toMatch(/unknown option/);
  });
});
