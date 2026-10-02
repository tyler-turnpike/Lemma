/**
 * HTTP proxy in front of the Lemma server that can drop the response of the next *paid*
 * `lemma_purchase_resolution` call after the server has fully processed (and settled) it.
 * Used by the fork demo to prove that a lost paid response is recovered without a second payment.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

import { freePort } from "./anvil.js";

export type FaultProxy = { url: string; dropNextPaidResponse(): void; dropped: number; close(): Promise<void> };

const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function isPaidPurchase(body: Buffer): boolean {
  try {
    const msg = JSON.parse(body.toString("utf8")) as { method?: string; params?: { name?: string; _meta?: Record<string, unknown> } };
    return msg.method === "tools/call" && msg.params?.name === "lemma_purchase_resolution" && msg.params._meta?.["x402/payment"] !== undefined;
  } catch {
    return false;
  }
}

export async function startFaultProxy(target: string): Promise<FaultProxy> {
  const port = await freePort();
  let armed = false;
  const state = { dropped: 0 };
  const server: Server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && typeof v === "string") headers[k] = v;
      const upstream = await fetch(`${target}${req.url ?? "/"}`, {
        method: req.method ?? "GET",
        headers,
        ...(body.length > 0 && req.method !== "GET" && req.method !== "HEAD" ? { body } : {}),
      });
      const payload = Buffer.from(await upstream.arrayBuffer());
      if (armed && isPaidPurchase(body)) {
        // The server settled and answered; the buyer never sees it.
        armed = false;
        state.dropped += 1;
        req.socket.destroy();
        return;
      }
      const out: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        if (!HOP.has(k) && k !== "content-encoding") out[k] = v;
      });
      res.writeHead(upstream.status, out);
      res.end(payload);
    })().catch(() => req.socket.destroy());
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));
  return {
    url: `http://127.0.0.1:${port}`,
    dropNextPaidResponse: () => {
      armed = true;
    },
    get dropped() {
      return state.dropped;
    },
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
