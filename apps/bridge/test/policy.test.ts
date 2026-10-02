import { ARBITRUM_SEPOLIA } from "@lemma/core";
import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";

import { SpendLedger } from "../src/ledger.js";
import { PaymentGuard, checkRequirement, precheckSpend, type PaymentExpectation } from "../src/policy.js";
import { FakeLemmaServer, buyer, copyFixture, loadRelease, makeBridge, other, provider, rand32, tempDir, testEnv } from "./helpers.js";

const NOW = new Date("2026-10-02T12:00:00Z");

function expectation(overrides: Partial<PaymentExpectation> = {}): PaymentExpectation {
  return {
    previewId: rand32(),
    buyer: buyer.address,
    priceAtomic: 120_000n,
    network: "eip155:421614",
    usdcAddress: ARBITRUM_SEPOLIA.usdc,
    payTo: provider.address,
    perResolutionCapAtomic: 250_000n,
    dailyCapAtomic: 1_000_000n,
    ...overrides,
  };
}

function requirement(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: "eip155:421614",
    asset: ARBITRUM_SEPOLIA.usdc,
    amount: "120000",
    payTo: provider.address,
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  };
}

describe("spend policy", () => {
  it("accepts a requirement that matches the preview", () => {
    expect(checkRequirement(requirement(), expectation(), 0n, NOW)).toEqual([]);
  });

  it("refuses a price over the per-resolution cap", () => {
    const exp = expectation({ priceAtomic: 300_000n });
    expect(precheckSpend(exp, 0n, NOW)).toContain("price exceeds per-resolution cap");
    expect(checkRequirement(requirement({ amount: "300000" }), exp, 0n, NOW)).toContain("price exceeds per-resolution cap");
  });

  it("refuses wrong payTo, network, token, amount, scheme and transfer method", () => {
    const exp = expectation();
    expect(checkRequirement(requirement({ payTo: other.address }), exp, 0n, NOW)).toContain("recipient does not match expected recipient");
    expect(checkRequirement(requirement({ network: "eip155:84532" }), exp, 0n, NOW)).toContain("network is not allowed");
    expect(checkRequirement(requirement({ asset: other.address }), exp, 0n, NOW)).toContain("token does not match expected token");
    expect(checkRequirement(requirement({ amount: "120001" }), exp, 0n, NOW)).toContain("amount does not equal the previewed price");
    expect(checkRequirement(requirement({ scheme: "upto" }), exp, 0n, NOW)).toContain("scheme must be exact");
    expect(checkRequirement(requirement({ extra: { assetTransferMethod: "permit2" } }), exp, 0n, NOW)).toContain(
      "only EIP-3009 transfer authorizations are allowed",
    );
  });

  it("persists the daily cap across restarts", async () => {
    const dir = await tempDir();
    const exp = expectation();
    const a = new SpendLedger(dir);
    for (let i = 0; i < 8; i++) await a.authorize(rand32(), 120_000n, NOW); // 0.96 USDC
    const restarted = new SpendLedger(dir);
    const spent = await restarted.spentOn(NOW);
    expect(spent).toBe(960_000n);
    expect(precheckSpend(exp, spent, NOW)).toContain("price exceeds remaining daily cap");
    // A new UTC day has a fresh budget.
    expect(await restarted.spentOn(new Date("2026-10-03T00:00:01Z"))).toBe(0n);
  });

  it("records each preview in the ledger only once", async () => {
    const ledger = new SpendLedger(await tempDir());
    const id = rand32();
    expect((await ledger.authorize(id, 120_000n, NOW)).created).toBe(true);
    expect((await ledger.authorize(id, 120_000n, NOW)).created).toBe(false);
    await ledger.settle(id, 120_000n, rand32(), rand32(), NOW);
    await ledger.settle(id, 120_000n, rand32(), rand32(), NOW);
    expect(await ledger.spentOn(NOW)).toBe(120_000n);
    expect(await ledger.entries()).toHaveLength(1);
  });

  it("fails closed on a corrupt ledger", async () => {
    const dir = await tempDir();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${dir}/ledger.json`, "{ not json");
    await expect(new SpendLedger(dir).spentOn(NOW)).rejects.toMatchObject({ code: "state" });
  });

  it("guard approves once, records the spend before approving, and refuses a second request", async () => {
    const ledger = new SpendLedger(await tempDir());
    const exp = expectation();
    const guard = new PaymentGuard(exp, ledger, () => NOW);
    const ctx = { toolName: "lemma_purchase_resolution", arguments: { previewId: exp.previewId, buyer: exp.buyer }, paymentRequired: { accepts: [requirement()] } };
    expect(await guard.onPaymentRequested(ctx)).toBe(true);
    expect((await ledger.get(exp.previewId))?.status).toBe("authorized");
    expect(await guard.onPaymentRequested(ctx)).toBe(false);
    expect(guard.refusals.join(" ")).toMatch(/already authorized/);
    expect(guard.policy(2, [requirement(), requirement({ amount: "999999" })])).toHaveLength(1);
    expect(await guard.beforePaymentCreation({ selectedRequirements: requirement({ payTo: other.address }) })).toMatchObject({ abort: true });
  });

  it("guard refuses a request for a different tool or preview", async () => {
    const ledger = new SpendLedger(await tempDir());
    const exp = expectation();
    const guard = new PaymentGuard(exp, ledger, () => NOW);
    const accepts = { accepts: [requirement()] };
    expect(await guard.onPaymentRequested({ toolName: "lemma_preview", arguments: {}, paymentRequired: accepts })).toBe(false);
    expect(await guard.onPaymentRequested({ toolName: "lemma_purchase_resolution", arguments: { previewId: rand32(), buyer: exp.buyer }, paymentRequired: accepts })).toBe(false);
    expect(await ledger.entries()).toHaveLength(0);
  });
});

describe("spend policy wired into the x402 client", () => {
  async function attempt(serverOptions: ConstructorParameters<typeof FakeLemmaServer>[0], envExtra: Record<string, string> = {}) {
    const server = new FakeLemmaServer(serverOptions, await loadRelease());
    const stateDir = await tempDir();
    const env = testEnv(stateDir, await copyFixture("mcp-server-exact"), envExtra);
    const { bridge } = makeBridge(server, env);
    const { preview } = await bridge.preview("x402-paywall-mcp-server");
    const error = await bridge.buy(preview.previewId).then(
      () => null,
      (e: unknown) => e,
    );
    return { server, error: error as { code?: string; details?: string[] } | null, ledger: new SpendLedger(stateDir) };
  }

  it("refuses when the server demands more than the previewed price", async () => {
    const { server, error, ledger } = await attempt({ amount: "200000" });
    expect(error?.code).toBe("policy");
    expect(error?.details).toContain("amount does not equal the previewed price");
    expect(server.payments).toBe(0);
    expect(await ledger.entries()).toHaveLength(0);
  });

  it("refuses a payment to someone other than the provider", async () => {
    const { server, error } = await attempt({ payTo: other.address });
    expect(error?.code).toBe("policy");
    expect(error?.details).toContain("recipient does not match expected recipient");
    expect(server.payments).toBe(0);
  });

  it("refuses the wrong network or token", async () => {
    const net = await attempt({ network: "eip155:84532" });
    expect(net.error?.code).toBe("policy");
    expect(net.server.payments).toBe(0);
    const token = await attempt({ asset: other.address });
    expect(token.error?.code).toBe("policy");
    expect(token.server.payments).toBe(0);
  });

  it("refuses before connecting when the preview price exceeds the local cap", async () => {
    const { server, error } = await attempt({ priceAtomic: "300000" });
    expect(error?.code).toBe("policy");
    expect(error?.details).toContain("price exceeds per-resolution cap");
    expect(server.probes).toBe(0);
  });

  it("refuses once the persisted daily cap is used up", async () => {
    const { server, error } = await attempt({}, { LEMMA_DAILY_USDC_CAP: "0.1" });
    expect(error?.code).toBe("policy");
    expect(server.payments).toBe(0);
  });
});

describe("daily cap across bridge restarts", () => {
  it("counts settled purchases from earlier processes", async () => {
    const server = new FakeLemmaServer({}, await loadRelease());
    const stateDir = await tempDir();
    const env = testEnv(stateDir, await copyFixture("mcp-server-exact"), { LEMMA_DAILY_USDC_CAP: "0.25" });
    for (let i = 0; i < 2; i++) {
      const { bridge } = makeBridge(server, env); // new process each time
      const { preview } = await bridge.preview("x402-paywall-mcp-server");
      await bridge.buy(preview.previewId);
    }
    expect(server.payments).toBe(2);
    const { bridge } = makeBridge(server, env);
    const { preview, local } = await bridge.preview("x402-paywall-mcp-server");
    expect(local.purchaseAllowedByLocalPolicy).toBe(false);
    await expect(bridge.buy(preview.previewId)).rejects.toMatchObject({ code: "policy" });
    expect(server.payments).toBe(2);
  });
});
