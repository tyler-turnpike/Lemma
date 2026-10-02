import { describe, expect, it } from "vitest";

import { SpendLedger } from "../src/ledger.js";
import { StateStore } from "../src/state.js";
import { FakeLemmaServer, buyer, copyFixture, loadRelease, makeBridge, provider, tempDir, testEnv } from "./helpers.js";

async function setup(options: ConstructorParameters<typeof FakeLemmaServer>[0] = {}) {
  const release = await loadRelease();
  const server = new FakeLemmaServer(options, release);
  const stateDir = await tempDir();
  const workspace = await copyFixture("mcp-server-exact");
  const env = testEnv(stateDir, workspace);
  return { server, env, stateDir, workspace };
}

describe("lemma_buy_resolution flow", () => {
  it("previews, pays once through x402, verifies, activates and stores", async () => {
    const { server, env, stateDir } = await setup();
    const { bridge, activator } = makeBridge(server, env);
    const preview = await bridge.preview("x402-paywall-mcp-server");
    expect(preview.preview.decision).toBe("reuse");
    expect(preview.local.purchaseAllowedByLocalPolicy).toBe(true);

    const result = await bridge.buy(preview.preview.previewId);
    expect(result.status).toBe("purchased");
    expect(server.payments).toBe(1);
    expect(result.voucherSigner.toLowerCase()).toBe(provider.address.toLowerCase());
    expect(result.activation?.status).toBe("activated");
    expect(activator.calls).toHaveLength(1);

    const ledger = new SpendLedger(stateDir);
    const entry = await ledger.get(preview.preview.previewId);
    expect(entry?.status).toBe("settled");
    expect(entry?.amountAtomic).toBe("120000");
    const stored = await new StateStore(stateDir).loadResolution(result.resolutionId);
    expect(stored?.activation?.status).toBe("activated");

    // Buying again (even after a "restart") returns the owned resolution without paying.
    const again = await makeBridge(server, env).bridge.buy(preview.preview.previewId);
    expect(again.status).toBe("already-owned");
    expect(server.payments).toBe(1);
    expect((await ledger.entries()).length).toBe(1);
  });

  it("recovers after the paid response is lost, without paying twice", async () => {
    const { server, env, stateDir } = await setup({ mode: "lose-response" });
    const { bridge } = makeBridge(server, env);
    const { preview } = await bridge.preview("x402-paywall-mcp-server");
    const result = await bridge.buy(preview.previewId);
    expect(result.status).toBe("recovered");
    expect(server.payments).toBe(1);
    expect(server.requests.filter((r) => (r as { tool: string }).tool === "lemma_recover_resolution").length).toBeGreaterThanOrEqual(1);
    expect((await new SpendLedger(stateDir).get(preview.previewId))?.status).toBe("settled");
  });

  it("after a lost response and failed recovery, a restarted bridge recovers instead of re-paying", async () => {
    const { server, env, stateDir } = await setup({ mode: "lose-response", recoverEnabled: false });
    const first = makeBridge(server, env);
    const { preview } = await first.bridge.preview("x402-paywall-mcp-server");
    await expect(first.bridge.buy(preview.previewId)).rejects.toMatchObject({ code: "recovery" });
    expect(server.payments).toBe(1);
    expect((await new SpendLedger(stateDir).get(preview.previewId))?.status).toBe("authorized");

    // Restart: new instances, server recovery back online, server would happily take a 2nd payment.
    server.options = { mode: "normal", recoverEnabled: true };
    const second = makeBridge(server, env);
    const result = await second.bridge.buy(preview.previewId);
    expect(result.status).toBe("recovered");
    expect(server.payments).toBe(1);
    expect(server.probes).toBe(1);
  });

  it("recovers when the server reports the purchase already settled (local state lost)", async () => {
    const { server, env, workspace } = await setup();
    const { bridge } = makeBridge(server, env);
    const { preview } = await bridge.preview("x402-paywall-mcp-server");
    await bridge.buy(preview.previewId);

    // Fresh state dir: the bridge forgot everything except the preview.
    const freshState = await tempDir();
    const env2 = testEnv(freshState, workspace);
    const stored = await new StateStore(env.LEMMA_STATE_DIR as string).loadPreview(preview.previewId);
    await new StateStore(freshState).savePreview(stored!);
    const result = await makeBridge(server, env2).bridge.buy(preview.previewId);
    expect(result.status).toBe("recovered");
    expect(server.payments).toBe(1);
    expect(result.resolutionId).toBeDefined();
    expect(buyer.address).toBeDefined();
  });
});

describe("forged delivery", () => {
  it("rejects and quarantines a resolution with a forged voucher; nothing is stored or activated", async () => {
    const { other } = await import("./helpers.js");
    const { readdir } = await import("node:fs/promises");
    const { server, env, stateDir } = await setup({ voucherSigner: other });
    const { bridge, activator } = makeBridge(server, env);
    const { preview } = await bridge.preview("x402-paywall-mcp-server");
    await expect(bridge.buy(preview.previewId)).rejects.toMatchObject({ code: "verification" });
    expect(activator.calls).toHaveLength(0);
    expect(await new StateStore(stateDir).loadResolutionByPreview(preview.previewId)).toBeNull();
    expect((await readdir(`${stateDir}/quarantine`)).length).toBe(1);
    // The spend stays recorded (payment was made), so a retry recovers rather than re-pays.
    expect((await new SpendLedger(stateDir).get(preview.previewId))?.status).toBe("authorized");
    await expect(makeBridge(server, env).bridge.buy(preview.previewId)).rejects.toMatchObject({ code: "verification" });
    expect(server.payments).toBe(1);
  });
});
