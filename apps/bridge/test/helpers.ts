import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARBITRUM_SEPOLIA,
  CapabilityRelease,
  PatchBundle,
  bundleDigest,
  digest,
  encodeBase64,
  lemmaDomain,
  releaseIdFor,
  sha256Hex,
  voucherTypedData,
  type AcceptanceRecipe,
  type PatchBundle as PatchBundleT,
  type Preview,
} from "@lemma/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bytesToHex, recoverMessageAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

import type { WarrantyActivator } from "../src/chain.js";
import { loadConfig } from "../src/config.js";
import { SpendLedger } from "../src/ledger.js";
import { Bridge } from "../src/operations.js";
import { createLogger, createScrubber } from "../src/redaction.js";
import { McpRemoteLemma, type TransportFactory } from "../src/remote.js";
import type { ActivationRecord } from "../src/state.js";
import { StateStore } from "../src/state.js";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const CATALOG = join(REPO_ROOT, "packages/catalog");
export const REGISTRY = "0x00000000000000000000000000000000000000aa" as Address;
export const RELEASE = "x402-mcp-server@1.0.0";

export const buyerKey = generatePrivateKey();
export const buyer = privateKeyToAccount(buyerKey);
export const providerKey = generatePrivateKey();
export const provider = privateKeyToAccount(providerKey);
export const otherKey = generatePrivateKey();
export const other = privateKeyToAccount(otherKey);

export const rand32 = () => bytesToHex(new Uint8Array(randomBytes(32)));

/** Builds a release's PatchBundle straight from catalog files (no @lemma/catalog dependency). */
export async function loadRelease(id = RELEASE): Promise<{ bundle: PatchBundleT; acceptance: AcceptanceRecipe; priceAtomic: string }> {
  const dir = join(CATALOG, "releases", id);
  const manifest = CapabilityRelease.parse(JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")));
  const operations = await Promise.all(
    manifest.patch.operations.map(async (op) => {
      const bytes = new Uint8Array(await readFile(join(dir, "payload", ...op.path.split("/"))));
      const common = { path: op.path, contentBase64: encodeBase64(bytes), newSha256: sha256Hex(bytes) };
      return op.op === "create" ? { op: "create" as const, baseSha256: null, ...common } : { op: "modify" as const, baseSha256: op.baseSha256, ...common };
    }),
  );
  const bundle = PatchBundle.parse({ schemaVersion: "1", release: manifest.id, operations, dependencyAdditions: manifest.patch.dependencyAdditions });
  if (bundleDigest(bundle) !== manifest.payloadDigest) throw new Error("catalog bundle digest mismatch");
  return { bundle, acceptance: manifest.acceptance, priceAtomic: manifest.priceAtomic };
}

export async function tempDir(prefix = "lemma-bridge-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function copyFixture(id: string): Promise<string> {
  const dest = await tempDir("lemma-ws-");
  await cp(join(CATALOG, "fixtures", id), dest, { recursive: true });
  return dest;
}

export async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p, base)));
    else out.push(p.slice(base.length + 1));
  }
  return out.sort();
}

export function makePreview(overrides: Partial<Preview> = {}, priceAtomic = "120000"): Preview {
  return {
    schemaVersion: "1",
    previewId: rand32(),
    task: { schemaVersion: "1", kind: "x402-paywall-mcp-server", network: "arbitrum-sepolia" },
    profileDigest: rand32(),
    decision: "reuse",
    releaseId: releaseIdFor(RELEASE),
    release: RELEASE,
    reasons: ["exact profile match"],
    evidence: { status: "provisional", benchmarkVersion: null, expectedSavingAtomic: null, expectedTokenSaving: null },
    priceAtomic,
    expectedSavingAtomic: null,
    limitations: [],
    warranty: { bondAtomic: priceAtomic, claimWindowSeconds: 259_200, coverage: "Refund credit if acceptance fails." },
    purchasable: true,
    provisionalOverride: true,
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A server-side purchase payload (resolution + provider-signed voucher). */
export async function makePurchase(opts: {
  preview: Preview;
  buyerAddress: Address;
  bundle: PatchBundleT;
  acceptance: AcceptanceRecipe;
  signer?: typeof provider;
  registry?: Address;
}) {
  const signer = opts.signer ?? provider;
  const resolutionId = rand32();
  const paymentHash = rand32();
  const payloadDigest = bundleDigest(opts.bundle);
  const price = opts.preview.priceAtomic ?? "0";
  const resolution = {
    schemaVersion: "1" as const,
    resolutionId,
    previewId: opts.preview.previewId,
    releaseId: opts.preview.releaseId ?? rand32(),
    release: RELEASE,
    buyer: opts.buyerAddress,
    priceAtomic: price,
    paymentHash,
    payloadDigest,
    bundle: opts.bundle,
    acceptance: opts.acceptance,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const message = {
    resolutionId,
    releaseId: resolution.releaseId,
    buyer: opts.buyerAddress,
    amount: price,
    paymentHash,
    payloadDigest,
    expiresAt: String(Math.floor(Date.now() / 1000) + 86_400),
  };
  const registry = opts.registry ?? REGISTRY;
  const signature = await signer.signTypedData(voucherTypedData(lemmaDomain(registry, ARBITRUM_SEPOLIA.chainId), message));
  const voucher = { schemaVersion: "1" as const, chainId: ARBITRUM_SEPOLIA.chainId, verifyingContract: registry, signer: provider.address, signature, voucher: message };
  return { resolution, voucher };
}

export type FakeServerOptions = {
  /** Override the x402 amount the server demands. */
  amount?: string;
  payTo?: string;
  network?: string;
  asset?: string;
  /**
   * "lose-response": settle, then never answer the paid call.
   * "reject-payment": answer the paid call with an x402 PaymentRequired (verification failed).
   * "settlement-failed": answer the paid call with "Payment settlement failed: ..." (ambiguous).
   */
  mode?: "normal" | "lose-response" | "reject-payment" | "settlement-failed";
  /** Error string used by reject-payment / settlement-failed. */
  rejectReason?: string;
  recoverEnabled?: boolean;
  acceptance?: AcceptanceRecipe;
  /** Error text returned by lemma_preview (to test scrubbing). */
  previewErrorText?: string;
  priceAtomic?: string;
  /** Sign vouchers with this account instead of the provider (forgery test). */
  voucherSigner?: typeof provider;
};

/**
 * In-process stand-in for the hosted Lemma MCP server, including a fake x402 layer that
 * demands payment with an exact/EIP-3009 requirement and verifies the buyer's signature.
 */
export class FakeLemmaServer {
  payments = 0;
  probes = 0;
  readonly previews = new Map<string, Preview>();
  readonly settled = new Map<string, Awaited<ReturnType<typeof makePurchase>>>();
  readonly receipts: unknown[] = [];
  requests: unknown[] = [];

  constructor(
    public options: FakeServerOptions,
    private readonly release: { bundle: PatchBundleT; acceptance: AcceptanceRecipe },
  ) {}

  private paymentRequired(preview: Preview) {
    return {
      x402Version: 2,
      resource: { url: "mcp://tool/lemma_purchase_resolution" },
      accepts: [
        {
          scheme: "exact",
          network: this.options.network ?? "eip155:421614",
          asset: this.options.asset ?? ARBITRUM_SEPOLIA.usdc,
          amount: this.options.amount ?? preview.priceAtomic,
          payTo: this.options.payTo ?? provider.address,
          maxTimeoutSeconds: 60,
          extra: { name: "USDC", version: "2" },
        },
      ],
    };
  }

  private build(): McpServer {
    const server = new McpServer({ name: "fake-lemma", version: "0.0.0" });
    const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }], structuredContent: v as Record<string, unknown> });
    const fail = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });

    server.registerTool("lemma_preview", { inputSchema: { task: z.any(), profile: z.any() } }, async (args) => {
      this.requests.push({ tool: "lemma_preview", args });
      if (this.options.previewErrorText !== undefined) return fail(this.options.previewErrorText);
      const preview = makePreview({ task: args.task as Preview["task"], profileDigest: digest(args.profile) }, this.options.priceAtomic ?? "120000");
      this.previews.set(preview.previewId, preview);
      return json(preview);
    });

    server.registerTool("lemma_purchase_resolution", { inputSchema: { previewId: z.string(), buyer: z.string() } }, async (args, extra) => {
      this.requests.push({ tool: "lemma_purchase_resolution", args, meta: extra._meta });
      const preview = this.previews.get(args.previewId);
      if (!preview) return fail("unknown preview");
      const key = `${args.previewId}:${args.buyer.toLowerCase()}`;
      if (this.settled.has(key)) return fail(JSON.stringify({ error: { code: "already_settled", message: "already purchased for this preview and buyer; call lemma_recover_resolution" } }));
      const payment = (extra._meta as Record<string, unknown> | undefined)?.["x402/payment"] as
        | { accepted: { amount: string; payTo: string; asset: string }; payload: { authorization: Record<string, string>; signature: Hex } }
        | undefined;
      if (payment === undefined) {
        this.probes += 1;
        const pr = this.paymentRequired(preview);
        return { isError: true, structuredContent: pr, content: [{ type: "text" as const, text: JSON.stringify(pr) }] };
      }
      const auth = payment.payload.authorization;
      const signerAddr = await recoverTypedDataAddress({
        domain: { name: "USDC", version: "2", chainId: 421614, verifyingContract: ARBITRUM_SEPOLIA.usdc },
        types: {
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        message: {
          from: auth["from"] as Address,
          to: auth["to"] as Address,
          value: BigInt(auth["value"] ?? "0"),
          validAfter: BigInt(auth["validAfter"] ?? "0"),
          validBefore: BigInt(auth["validBefore"] ?? "0"),
          nonce: auth["nonce"] as Hex,
        },
        signature: payment.payload.signature,
      });
      if (signerAddr.toLowerCase() !== args.buyer.toLowerCase()) return fail("payment signature invalid");
      if (this.options.mode === "reject-payment" || this.options.mode === "settlement-failed") {
        const reason = this.options.rejectReason ?? (this.options.mode === "reject-payment" ? "invalid_exact_evm_insufficient_balance" : "Payment settlement failed: transaction_failed");
        const pr = { ...this.paymentRequired(preview), error: reason };
        return { isError: true, structuredContent: pr, content: [{ type: "text" as const, text: JSON.stringify(pr) }] };
      }
      this.payments += 1;
      const purchase = await makePurchase({
        preview,
        buyerAddress: args.buyer as Address,
        bundle: this.release.bundle,
        acceptance: this.options.acceptance ?? this.release.acceptance,
        ...(this.options.voucherSigner ? { signer: this.options.voucherSigner } : {}),
      });
      this.settled.set(key, purchase);
      if (this.options.mode === "lose-response") await new Promise(() => undefined);
      return json(purchase);
    });

    server.registerTool("lemma_recover_resolution", { inputSchema: { previewId: z.string(), buyer: z.string() } }, async (args) => {
      this.requests.push({ tool: "lemma_recover_resolution", args });
      if (this.options.recoverEnabled === false) return fail("recovery temporarily unavailable");
      const found = this.settled.get(`${args.previewId}:${args.buyer.toLowerCase()}`);
      return json(found ?? { found: false });
    });

    server.registerTool("lemma_submit_receipt", { inputSchema: { schemaVersion: z.string(), receipt: z.any(), signature: z.string() } }, async (args) => {
      this.requests.push({ tool: "lemma_submit_receipt", args });
      const { adoptionReceiptDigest } = await import("@lemma/core");
      const signerAddr = await recoverMessageAddress({ message: { raw: adoptionReceiptDigest(args.receipt) }, signature: args.signature as Hex });
      if (signerAddr.toLowerCase() !== String(args.receipt.buyer).toLowerCase()) return fail("bad receipt signature");
      this.receipts.push(args);
      return json({ accepted: true, receiptId: `rcpt-${this.receipts.length}` });
    });
    return server;
  }

  transportFactory: TransportFactory = () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    void this.build().connect(serverSide);
    return clientSide;
  };
}

export class FakeActivator implements WarrantyActivator {
  calls: unknown[] = [];
  async activate(voucher: unknown): Promise<ActivationRecord> {
    this.calls.push(voucher);
    return { status: "activated", txHash: rand32(), blockNumber: "1", reason: null, at: new Date().toISOString() };
  }
}

export function testEnv(stateDir: string, workspace: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    LEMMA_API_URL: "http://lemma.test",
    LEMMA_WORKSPACE: workspace,
    LEMMA_STATE_DIR: stateDir,
    BUYER_PRIVATE_KEY: buyerKey,
    LEMMA_PROVIDER_ADDRESS: provider.address,
    RESOLUTION_WARRANTY_REGISTRY_ADDRESS: REGISTRY,
    PATH: process.env["PATH"] ?? "",
    ...extra,
  };
}

/** A fully wired bridge against the fake server; a new call simulates a process restart. */
export function makeBridge(server: FakeLemmaServer, env: Record<string, string>, logs: string[] = [], extra: Partial<ConstructorParameters<typeof Bridge>[0]> = {}) {
  const loaded = loadConfig(env);
  const scrub = createScrubber(loaded.secrets);
  const log = createLogger(scrub, (l) => logs.push(l));
  const account = privateKeyToAccount(loaded.buyerPrivateKey as Hex);
  const activator = new FakeActivator();
  const bridge = new Bridge({
    config: loaded.config,
    buyer: account,
    remote: new McpRemoteLemma(server.transportFactory, account, loaded.config),
    ledger: new SpendLedger(loaded.config.stateDir),
    store: new StateStore(loaded.config.stateDir),
    activator,
    log,
    purchaseTimeoutMs: 1_500,
    recoverTimeoutMs: 1_500,
    recoverAttempts: 2,
    recoverDelayMs: 10,
    acceptanceEnv: env as NodeJS.ProcessEnv,
    ...extra,
  });
  return { bridge, activator, config: loaded.config, scrub, log };
}
