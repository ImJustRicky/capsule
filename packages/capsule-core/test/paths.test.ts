import { describe, it, expect } from "vitest";
import { validateArchivePath, CapsuleError } from "../src/index.js";

describe("validateArchivePath", () => {
  it("accepts well-formed relative paths", () => {
    expect(validateArchivePath("content/index.html")).toBe("content/index.html");
    expect(validateArchivePath("assets/img.png")).toBe("assets/img.png");
  });

  it("rejects empty", () => {
    expect(() => validateArchivePath("")).toThrow(CapsuleError);
  });

  it("rejects absolute paths", () => {
    expect(() => validateArchivePath("/etc/passwd")).toThrow(/absolute|relative/);
  });

  it("rejects parent traversal", () => {
    expect(() => validateArchivePath("content/../escape")).toThrow(/traversal|\.\./);
  });

  it("rejects backslashes", () => {
    expect(() => validateArchivePath("content\\x.html")).toThrow(/forward slashes/);
  });

  it("rejects Windows drive prefixes", () => {
    expect(() => validateArchivePath("C:/x")).toThrow(/drive/);
  });

  it("rejects NUL bytes", () => {
    expect(() => validateArchivePath("foo\0bar")).toThrow(/NUL/);
  });
});
