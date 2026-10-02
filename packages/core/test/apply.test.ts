import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeBase64, sha256Hex, type PatchBundle } from "../src/index.js";
import { ApplyError, applyBundle, runAcceptance, summarizeVitestOutput } from "../src/node/index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const op = (path: string, content: string, base: string | null) =>
  base === null
    ? { op: "create" as const, path, baseSha256: null, contentBase64: encodeBase64(enc(content)), newSha256: sha256Hex(enc(content)) }
    : { op: "modify" as const, path, baseSha256: sha256Hex(enc(base)), contentBase64: encodeBase64(enc(content)), newSha256: sha256Hex(enc(content)) };

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lemma-apply-"));
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "src/server.ts"), "old\n");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x", dependencies: { zod: "4.6.5" } }, null, 2));
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

function bundle(ops: PatchBundle["operations"], deps: Record<string, string> = {}): PatchBundle {
  return { schemaVersion: "1", release: "demo@1.0.0", operations: ops, dependencyAdditions: { dependencies: deps, devDependencies: {} } };
}

describe("applyBundle", () => {
  it("dry-runs by default without mutating", async () => {
    const r = await applyBundle(dir, bundle([op("src/new.ts", "new\n", null), op("src/server.ts", "patched\n", "old\n")]));
    expect(r.dryRun).toBe(true);
    expect(r.filesChanged).toBe(2);
    expect(await readFile(join(dir, "src/server.ts"), "utf8")).toBe("old\n");
    await expect(lstat(join(dir, "src/new.ts"))).rejects.toThrow();
  });

  it("applies creates, modifies and dependency additions, then is idempotent", async () => {
    const b = bundle([op("src/lemma/new.ts", "new\n", null), op("src/server.ts", "patched\n", "old\n")], { "@x402/mcp": "2.27.0", zod: "4.6.5" });
    const r = await applyBundle(dir, b, { dryRun: false });
    expect(r.filesChanged).toBe(3);
    expect(r.dependencyChanges).toEqual([{ section: "dependencies", name: "@x402/mcp", version: "2.27.0" }]);
    expect(await readFile(join(dir, "src/lemma/new.ts"), "utf8")).toBe("new\n");
    expect(await readFile(join(dir, "src/server.ts"), "utf8")).toBe("patched\n");
    const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    expect(pkg.dependencies).toEqual({ "@x402/mcp": "2.27.0", zod: "4.6.5" });
    expect((await readdir(dir)).some((n) => n.startsWith(".lemma-staging"))).toBe(false);
    const again = await applyBundle(dir, b, { dryRun: false });
    expect(again.filesChanged).toBe(0);
    expect(again.changes.every((c) => c.status === "unchanged")).toBe(true);
  });

  it("detects base drift before mutating anything", async () => {
    const b = bundle([op("src/a.ts", "a\n", null), op("src/server.ts", "patched\n", "something else\n")]);
    await expect(applyBundle(dir, b, { dryRun: false })).rejects.toMatchObject({ code: "drift" });
    await expect(lstat(join(dir, "src/a.ts"))).rejects.toThrow();
  });

  it("refuses to overwrite an existing file on create", async () => {
    await expect(applyBundle(dir, bundle([op("src/server.ts", "x\n", null)]), { dryRun: false })).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects dependency version conflicts", async () => {
    await expect(applyBundle(dir, bundle([op("src/a.ts", "a\n", null)], { zod: "3.25.0" }))).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects symlinked parents and targets", async () => {
    const outside = await mkdtemp(join(tmpdir(), "lemma-outside-"));
    try {
      await symlink(outside, join(dir, "linked"));
      await expect(applyBundle(dir, bundle([op("linked/evil.ts", "x\n", null)]), { dryRun: false })).rejects.toMatchObject({ code: "unsafe-path" });
      await symlink(join(outside, "t.ts"), join(dir, "src/t.ts"));
      await expect(applyBundle(dir, bundle([op("src/t.ts", "x\n", null)]), { dryRun: false })).rejects.toMatchObject({ code: "unsafe-path" });
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects invalid bundles (bad path, bad digest, binary)", async () => {
    const traversal = bundle([op("src/a.ts", "a\n", null)]);
    (traversal.operations[0] as { path: string }).path = "../escape.ts";
    await expect(applyBundle(dir, traversal)).rejects.toBeInstanceOf(ApplyError);
    const badDigest = bundle([op("src/a.ts", "a\n", null)]);
    badDigest.operations[0]!.newSha256 = "0".repeat(64);
    await expect(applyBundle(dir, badDigest)).rejects.toMatchObject({ code: "invalid-bundle" });
    await expect(applyBundle(dir, bundle([op("src/a.bin", "a\u0000b", null)]))).rejects.toMatchObject({ code: "invalid-bundle" });
  });
});

describe("runAcceptance", () => {
  it("runs argv without a shell and forwards only allowlisted env", async () => {
    const run = await runAcceptance(
      dir,
      { argv: [["node", "-e", "if (process.env.BUYER_PRIVATE_KEY) process.exit(3); console.log('ok $HOME')"]], timeoutMs: 10_000, env: ["CI"] },
      { env: { ...process.env, BUYER_PRIVATE_KEY: `0x${"ab".repeat(32)}` } },
    );
    expect(run.passed).toBe(true);
    expect(run.steps[0]?.output).toContain("ok $HOME");
  });

  it("stops on failure and enforces the timeout", async () => {
    const fail = await runAcceptance(dir, { argv: [["node", "-e", "process.exit(2)"], ["node", "-e", "0"]], timeoutMs: 10_000, env: [] });
    expect(fail.passed).toBe(false);
    expect(fail.steps).toHaveLength(1);
    expect(fail.steps[0]?.exitCode).toBe(2);
    const slow = await runAcceptance(dir, { argv: [["node", "-e", "setTimeout(()=>{}, 20000)"]], timeoutMs: 1_000, env: [] });
    expect(slow.passed).toBe(false);
    expect(slow.steps[0]?.timedOut).toBe(true);
  });

  it("parses vitest totals", () => {
    expect(summarizeVitestOutput(" Tests  1 failed | 4 passed (5)")).toEqual({ passed: 4, failed: 1, skipped: 0 });
  });
});
