import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { buyerKey } from "./helpers.js";

describe("bridge config", () => {
  it("applies defaults", () => {
    const { config, buyerPrivateKey } = loadConfig({}, "/work");
    expect(config.workspace).toBe("/work");
    expect(config.perResolutionCapAtomic).toBe(250_000n);
    expect(config.dailyCapAtomic).toBe(1_000_000n);
    expect(config.mcpUrl).toBe("http://localhost:3000/mcp");
    expect(config.usdcAddress).toBe("0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
    expect(config.stateDir.endsWith(".lemma")).toBe(true);
    expect(config.registryAddress).toBeNull();
    expect(buyerPrivateKey).toBeNull();
  });

  it("names invalid variables without echoing secret values", () => {
    const bad = `${buyerKey}ff`;
    let message = "";
    try {
      loadConfig({ BUYER_PRIVATE_KEY: bad, LEMMA_MAX_USDC_PER_RESOLUTION: "-1" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("BUYER_PRIVATE_KEY");
    expect(message).toContain("LEMMA_MAX_USDC_PER_RESOLUTION");
    expect(message).not.toContain(buyerKey.slice(2, 20));
  });

  it("registers the key and RPC URL as secrets to scrub", () => {
    const { secrets, config } = loadConfig({ BUYER_PRIVATE_KEY: buyerKey, ARBITRUM_SEPOLIA_RPC_URL: "https://rpc.example/v2/apikey123", LEMMA_API_URL: "https://api.lemma.test/" });
    expect(secrets).toContain(buyerKey);
    expect(secrets).toContain("https://rpc.example/v2/apikey123");
    expect(config.mcpUrl).toBe("https://api.lemma.test/mcp");
  });
});
