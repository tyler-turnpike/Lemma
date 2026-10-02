// Benchmark-owned acceptance test for the no-match task "express-x402-paywall".
// No Lemma Capability Release covers an Express API, so this file is the task's
// definition of done in both arms. Runs fully offline: an in-process HTTP
// facilitator stands in for a real one and rejects every payment.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { x402Client } from "@x402/core/client";
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const NETWORK = "eip155:421614";
const USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
const PAY_TO = "0x1111111111111111111111111111111111111111";

const facilitatorCalls: string[] = [];
let facilitator: Server;
let api: Server;
let base: string;

async function drain(req: IncomingMessage): Promise<void> {
  for await (const _chunk of req) {
    // discard
  }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

beforeAll(async () => {
  facilitator = createServer((req, res) => {
    void drain(req).then(() => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      facilitatorCalls.push(path);
      res.setHeader("content-type", "application/json");
      if (path.endsWith("/supported")) {
        res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} }));
      } else if (path.endsWith("/verify")) {
        res.end(JSON.stringify({ isValid: false, invalidReason: "invalid_signature" }));
      } else if (path.endsWith("/settle")) {
        res.end(JSON.stringify({ success: false, errorReason: "invalid_signature", transaction: "", network: NETWORK }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  process.env.X402_FACILITATOR_URL = await listen(facilitator);
  process.env.X402_PAY_TO = PAY_TO;
  process.env.X402_PRICE_ATOMIC = "10000";
  const { default: app } = (await import("../src/app.js")) as { default: Parameters<typeof createServer>[1] };
  api = createServer(app);
  base = await listen(api);
});

afterAll(async () => {
  await new Promise((r) => api?.close(r));
  await new Promise((r) => facilitator?.close(r));
});

async function unpaid() {
  const res = await fetch(`${base}/forecast/Lisbon`);
  return { res, body: await res.text() };
}

describe("x402 paywall on the Express forecast API", () => {
  it("keeps GET /health free", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers an unpaid forecast request with 402 and x402 v2 USDC requirements", async () => {
    const { res, body } = await unpaid();
    expect(res.status).toBe(402);
    expect(body).not.toContain("sunny");
    const header = res.headers.get("payment-required");
    expect(header).toBeTruthy();
    const required = decodePaymentRequiredHeader(header!);
    expect(required.x402Version).toBe(2);
    const accept = required.accepts[0];
    expect(accept?.scheme).toBe("exact");
    expect(accept?.network).toBe(NETWORK);
    expect(accept?.asset.toLowerCase()).toBe(USDC.toLowerCase());
    expect(accept?.amount).toBe("10000");
    expect(accept?.payTo.toLowerCase()).toBe(PAY_TO);
  });

  it("verifies a signed payment with the configured facilitator and refuses it when verification fails", async () => {
    const { res } = await unpaid();
    const required = decodePaymentRequiredHeader(res.headers.get("payment-required")!);
    const client = new x402Client().register(NETWORK, new ExactEvmScheme(privateKeyToAccount(generatePrivateKey())));
    const payload = await client.createPaymentPayload(required);
    const before = facilitatorCalls.filter((p) => p.endsWith("/verify")).length;
    const paid = await fetch(`${base}/forecast/Lisbon`, { headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) } });
    const body = await paid.text();
    expect(paid.status).toBe(402);
    expect(body).not.toContain("sunny");
    expect(facilitatorCalls.filter((p) => p.endsWith("/verify")).length).toBe(before + 1);
    expect(facilitatorCalls.some((p) => p.endsWith("/settle"))).toBe(false);
  });

  it("rejects a malformed payment header without serving the forecast", async () => {
    const res = await fetch(`${base}/forecast/Lisbon`, { headers: { "PAYMENT-SIGNATURE": "not-a-payment" } });
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain("sunny");
  });
});
