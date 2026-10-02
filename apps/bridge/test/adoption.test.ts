import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { adoptionReceiptDigest } from "@lemma/core";
import { recoverMessageAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { StateStore } from "../src/state.js";
import { FakeLemmaServer, buyer, copyFixture, listFiles, loadRelease, makeBridge, tempDir, testEnv } from "./helpers.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of await listFiles(dir)) out[f] = sha(await readFile(join(dir, f)));
  return out;
}

async function purchased(options: ConstructorParameters<typeof FakeLemmaServer>[0] = {}) {
  const server = new FakeLemmaServer(options, await loadRelease());
  const stateDir = await tempDir();
  const workspace = await copyFixture("mcp-server-exact");
  const env = testEnv(stateDir, workspace);
  const { bridge } = makeBridge(server, env);
  const { preview } = await bridge.preview("x402-paywall-mcp-server");
  const bought = await bridge.buy(preview.previewId);
  return { server, bridge, workspace, stateDir, resolutionId: bought.resolutionId };
}

describe("lemma_apply_resolution", () => {
  it("dry run changes nothing; apply writes the bundle atomically", async () => {
    const { bridge, workspace, resolutionId, stateDir } = await purchased();
    const before = await snapshot(workspace);

    const dry = await bridge.apply(resolutionId, false);
    expect(dry.dryRun).toBe(true);
    expect(dry.changes.map((c) => c.path).sort()).toEqual(["src/lemma/x402-paywall.ts", "src/server.ts", "test/lemma-x402-paywall.test.ts"]);
    expect(dry.changes.every((c) => c.status === "pending")).toBe(true);
    expect(dry.dependencyChanges.map((d) => d.name)).toContain("@x402/mcp");
    expect(await snapshot(workspace)).toEqual(before);

    const applied = await bridge.apply(resolutionId, true);
    expect(applied.dryRun).toBe(false);
    expect(applied.filesChanged).toBe(4);
    const after = await snapshot(workspace);
    expect(after["src/lemma/x402-paywall.ts"]).toBeDefined();
    expect(after["src/server.ts"]).not.toBe(before["src/server.ts"]);
    const pkg = JSON.parse(await readFile(join(workspace, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@x402/mcp"]).toBe("2.27.0");
    expect((await new StateStore(stateDir).loadResolution(resolutionId))?.apply?.filesChanged).toBe(4);

    // Re-applying is a no-op.
    const again = await bridge.apply(resolutionId, true);
    expect(again.changes.every((c) => c.status === "unchanged")).toBe(true);
  });

  it("stops on base drift before writing anything", async () => {
    const { bridge, workspace, resolutionId } = await purchased();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(workspace, "src/server.ts"), "// locally edited\n");
    const before = await snapshot(workspace);
    await expect(bridge.apply(resolutionId, true)).rejects.toMatchObject({ code: "apply" });
    expect(await snapshot(workspace)).toEqual(before);
  });

  it("rejects unknown resolution ids", async () => {
    const { bridge } = await purchased();
    await expect(bridge.apply(`0x${"ab".repeat(32)}`, false)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("lemma_verify_adoption", () => {
  const passing = { argv: [["node", "-e", "console.log(' Tests  3 passed (3)')"]], timeoutMs: 10_000, env: [] };
  const failing = { argv: [["node", "-e", "console.log(' Tests  1 failed | 2 passed (3)'); process.exit(1)"]], timeoutMs: 10_000, env: [] };

  it("refuses to sign before the resolution is applied", async () => {
    const { bridge, resolutionId, server } = await purchased({ acceptance: passing });
    await expect(bridge.verifyAdoption(resolutionId)).rejects.toMatchObject({ code: "acceptance" });
    expect(server.receipts).toHaveLength(0);
  });

  it("runs acceptance, signs an EIP-191 receipt that recovers to the buyer, and submits it", async () => {
    const { bridge, resolutionId, server, stateDir } = await purchased({ acceptance: passing });
    await bridge.apply(resolutionId, true);
    const r = await bridge.verifyAdoption(resolutionId);
    expect(r.outcome).toBe("passed");
    expect(r.receipt.testSummary).toMatchObject({ passed: 3, failed: 0, exitCode: 0 });
    expect(r.receipt.filesChanged).toBe(4);
    expect(r.submitted).toBe(true);
    expect(r.receiptId).toBe("rcpt-1");
    const stored = await new StateStore(stateDir).loadResolution(resolutionId);
    const signed = stored!.receipt!.signed;
    const recovered = await recoverMessageAddress({ message: { raw: adoptionReceiptDigest(signed.receipt) as Hex }, signature: signed.signature as Hex });
    expect(recovered.toLowerCase()).toBe(buyer.address.toLowerCase());
    expect(server.receipts).toHaveLength(1);
  });

  it("signs a failed receipt when acceptance fails", async () => {
    const { bridge, resolutionId } = await purchased({ acceptance: failing });
    await bridge.apply(resolutionId, true);
    const r = await bridge.verifyAdoption(resolutionId);
    expect(r.outcome).toBe("failed");
    expect(r.receipt.testSummary).toMatchObject({ passed: 2, failed: 1, exitCode: 1 });
    expect(r.submitted).toBe(true);
  });
});
