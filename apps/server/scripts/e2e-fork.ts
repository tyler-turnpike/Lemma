/**
 * End-to-end run against an Anvil fork of Arbitrum Sepolia. Not part of `npm test`.
 *
 *   npm run e2e:fork -w @lemma/server
 *   # or: npx tsx apps/server/scripts/e2e-fork.ts
 *
 * Env (all optional):
 *   ARBITRUM_SEPOLIA_RPC_URL  fork source (default https://sepolia-rollup.arbitrum.io/rpc)
 *   ANVIL_BIN / FORGE_BIN     binaries (default /root/.local/bin/{anvil,forge}, then PATH)
 *
 * What it does, using ONLY Anvil's well-known public dev accounts (never real secrets):
 *   1. Starts `anvil --fork-url ...` (chain id 421614, real Arbitrum Sepolia USDC bytecode).
 *   2. Deploys ResolutionWarrantyRegistry with `forge create` (no files written under contracts/).
 *   3. Funds the buyer and provider with USDC by writing the token's balance storage slot.
 *   4. Registers the release and deposits the provider bond.
 *   5. Starts the real Lemma server (HTTP, self-hosted facilitator signing with the dev
 *      facilitator key against the fork) on a random port.
 *   6. Buyer: lemma_preview -> lemma_purchase_resolution (real x402 EIP-3009 payment,
 *      settled on the fork) -> verifies voucher + digest -> activateResolution onchain ->
 *      lemma_recover_resolution (no second payment) -> lemma_submit_receipt.
 * Exits non-zero on any failed check.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { loadCatalog } from "@lemma/catalog";
import {
  CompatibilityResolution,
  Preview,
  SignedResolutionVoucher,
  adoptionReceiptDigest,
  bundleDigest,
  lemmaDomain,
  voucherTypedData,
  voucherTypedMessage,
  type TaskRequest,
} from "@lemma/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { createx402MCPClient } from "@x402/mcp";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  numberToHex,
  parseAbi,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/log.js";
import { MemoryRepository } from "../src/repository/memory.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const RPC = process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
const USDC: Address = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

// Anvil's default mnemonic accounts ("test test ... junk"). Public, test-only keys.
const DEV = {
  admin: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  provider: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  facilitator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  evaluator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  buyer: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
} as const satisfies Record<string, Hex>;

const REGISTRY_ABI = parseAbi([
  "function registerRelease(bytes32 releaseId, address provider, address evaluator, uint256 price, uint64 claimWindow)",
  "function depositBond(bytes32 releaseId, uint256 amount)",
  "function activateResolution((bytes32 resolutionId, bytes32 releaseId, address buyer, uint256 amount, bytes32 paymentHash, bytes32 payloadDigest, uint64 expiresAt) v, bytes providerSig)",
  "function getWarranty(bytes32 resolutionId) view returns ((bytes32 releaseId, address buyer, uint256 amount, uint64 claimDeadline, uint8 status, bytes32 paymentHash, bytes32 payloadDigest, bytes32 evidenceDigest))",
  "function hashVoucher((bytes32 resolutionId, bytes32 releaseId, address buyer, uint256 amount, bytes32 paymentHash, bytes32 payloadDigest, uint64 expiresAt) v) view returns (bytes32)",
  "function paymentHashUsed(bytes32) view returns (bool)",
]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address, uint256) returns (bool)"]);

const step = (msg: string) => process.stdout.write(`\n==> ${msg}\n`);
const info = (msg: string) => process.stdout.write(`    ${msg}\n`);
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  info(`ok: ${msg}`);
}

function bin(name: "anvil" | "forge"): string {
  const env = process.env[`${name.toUpperCase()}_BIN`];
  if (env !== undefined && env !== "") return env;
  const local = join("/root/.local/bin", name);
  return existsSync(local) ? local : name;
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => res(port));
    });
  });
}

async function startAnvil(port: number): Promise<ChildProcess> {
  const child = spawn(bin("anvil"), ["--fork-url", RPC, "--port", String(port), "--chain-id", "421614", "--silent"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
  const client = createPublicClient({ transport: http(`http://127.0.0.1:${port}`) });
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null) throw new Error(`anvil exited: ${stderr}`);
    try {
      if ((await client.getChainId()) === 421614) return child;
    } catch {
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  child.kill();
  throw new Error("anvil did not become ready");
}

async function main(): Promise<void> {
  const anvilPort = await freePort();
  const anvilUrl = `http://127.0.0.1:${anvilPort}`;
  const accounts = Object.fromEntries(Object.entries(DEV).map(([k, v]) => [k, privateKeyToAccount(v)])) as Record<keyof typeof DEV, ReturnType<typeof privateKeyToAccount>>;
  const cleanups: Array<() => void | Promise<void>> = [];

  try {
    step(`starting anvil fork of ${RPC} on ${anvilUrl}`);
    const anvil = await startAnvil(anvilPort);
    cleanups.push(() => void anvil.kill("SIGTERM"));
    const transport = http(anvilUrl);
    const pub = createPublicClient({ chain: arbitrumSepolia, transport });
    const wallet = (who: keyof typeof DEV) => createWalletClient({ account: accounts[who], chain: arbitrumSepolia, transport });
    info(`fork block ${await pub.getBlockNumber()}`);

    // ---- deploy registry -------------------------------------------------------------
    step("deploying ResolutionWarrantyRegistry with forge create");
    const forge = spawnSync(
      bin("forge"),
      [
        "create",
        "src/ResolutionWarrantyRegistry.sol:ResolutionWarrantyRegistry",
        "--broadcast",
        "--rpc-url",
        anvilUrl,
        "--private-key",
        DEV.admin,
        "--constructor-args",
        USDC,
        accounts.admin.address,
      ],
      { cwd: join(repoRoot, "contracts"), encoding: "utf8", env: { ...process.env, FOUNDRY_OFFLINE: "true" }, timeout: 300_000 },
    );
    const deployed = /Deployed to:\s*(0x[0-9a-fA-F]{40})/.exec(forge.stdout ?? "");
    if (deployed?.[1] === undefined) throw new Error(`forge create failed: ${forge.stderr || forge.stdout}`);
    const registry = deployed[1] as Address;
    info(`registry ${registry}`);

    // ---- fund USDC via storage slot ----------------------------------------------------
    step("funding buyer and provider with fork USDC (storage write)");
    const balanceOf = (a: Address) => pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [a] });
    const target = 100_000_000n; // 100 USDC
    let slotFound: number | undefined;
    for (let slot = 0; slot < 20 && slotFound === undefined; slot++) {
      const key = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [accounts.buyer.address, BigInt(slot)]));
      const before = await pub.getStorageAt({ address: USDC, slot: key });
      await pub.request({ method: "anvil_setStorageAt" as never, params: [USDC, key, numberToHex(target, { size: 32 })] as never });
      if ((await balanceOf(accounts.buyer.address)) === target) slotFound = slot;
      else await pub.request({ method: "anvil_setStorageAt" as never, params: [USDC, key, before ?? numberToHex(0n, { size: 32 })] as never });
    }
    if (slotFound === undefined) throw new Error("could not locate the USDC balance slot");
    const providerKey = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [accounts.provider.address, BigInt(slotFound)]));
    await pub.request({ method: "anvil_setStorageAt" as never, params: [USDC, providerKey, numberToHex(target, { size: 32 })] as never });
    check((await balanceOf(accounts.buyer.address)) === target, `buyer funded with 100 USDC (balance slot ${slotFound})`);
    for (const who of Object.keys(DEV) as Array<keyof typeof DEV>) {
      await pub.request({ method: "anvil_setBalance" as never, params: [accounts[who].address, numberToHex(10n ** 19n)] as never });
      // The dev keys are public, so on real testnets these addresses often carry EIP-7702
      // delegation code planted by sweeper bots. Clear it on the fork so they behave as EOAs.
      const code = await pub.getCode({ address: accounts[who].address });
      if (code !== undefined && code !== "0x") {
        await pub.request({ method: "anvil_setCode" as never, params: [accounts[who].address, "0x"] as never });
        info(`cleared forked code at ${who} ${accounts[who].address} (${code.slice(0, 10)}...)`);
      }
    }

    // ---- register release + bond --------------------------------------------------------
    const catalog = loadCatalog();
    const release = catalog.getRelease("x402-mcp-server@1.0.0");
    if (release === undefined) throw new Error("release missing");
    step(`registering ${release.manifest.id} (price ${release.manifest.priceAtomic}, bond ${release.manifest.bondAtomic})`);
    const price = BigInt(release.manifest.priceAtomic);
    const bond = BigInt(release.manifest.bondAtomic);
    const send = async (hash: Promise<Hex>) => {
      const receipt = await pub.waitForTransactionReceipt({ hash: await hash });
      if (receipt.status !== "success") throw new Error(`tx reverted ${receipt.transactionHash}`);
      return receipt;
    };
    await send(
      wallet("admin").writeContract({
        address: registry,
        abi: REGISTRY_ABI,
        functionName: "registerRelease",
        args: [release.releaseId, accounts.provider.address, accounts.evaluator.address, price, BigInt(release.manifest.claimWindowSeconds)],
      }),
    );
    await send(wallet("provider").writeContract({ address: USDC, abi: ERC20_ABI, functionName: "approve", args: [registry, bond] }));
    await send(wallet("provider").writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "depositBond", args: [release.releaseId, bond] }));
    info("release registered and bond deposited");

    // ---- server ------------------------------------------------------------------------
    const serverPort = await freePort();
    const baseUrl = `http://127.0.0.1:${serverPort}`;
    step(`starting Lemma server on ${baseUrl} (self-hosted facilitator -> fork)`);
    const config = loadConfig({
      NODE_ENV: "development",
      PORT: String(serverPort),
      PUBLIC_BASE_URL: baseUrl,
      ARBITRUM_SEPOLIA_RPC_URL: anvilUrl,
      RESOLUTION_WARRANTY_REGISTRY_ADDRESS: registry,
      PROVIDER_ADDRESS: accounts.provider.address,
      PROVIDER_PRIVATE_KEY: DEV.provider,
      FACILITATOR_ADDRESS: accounts.facilitator.address,
      FACILITATOR_PRIVATE_KEY: DEV.facilitator,
      EVALUATOR_ADDRESS: accounts.evaluator.address,
      LEMMA_ALLOW_PROVISIONAL: "true",
    });
    const repo = new MemoryRepository();
    const { app, paidDisabledReason } = createApp({ config, repo, catalog, logger: createLogger({ secrets: config.secrets }), webDistDir: null });
    check(paidDisabledReason === null, "paid tools enabled");
    const server = serve({ fetch: app.fetch, port: serverPort, hostname: "127.0.0.1" });
    cleanups.push(() => new Promise<void>((r) => server.close(() => r())));
    const supported = (await (await fetch(`${baseUrl}/facilitator/supported`)).json()) as { kinds: Array<{ network: string; scheme: string }> };
    check(supported.kinds.some((k) => k.network === "eip155:421614" && k.scheme === "exact"), "facilitator supports exact on eip155:421614");

    // ---- buyer flow -------------------------------------------------------------------
    const mcpUrl = new URL(`${baseUrl}/mcp`);
    const free = new Client({ name: "e2e-buyer", version: "0.0.0" });
    await free.connect(new StreamableHTTPClientTransport(mcpUrl));
    cleanups.push(() => free.close());

    step("lemma_preview");
    const task: TaskRequest = { schemaVersion: "1", kind: "x402-paywall-mcp-server", network: "arbitrum-sepolia" };
    const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile: catalog.fixtureProfile("mcp-server-exact") } })).structuredContent);
    check(preview.purchasable && preview.priceAtomic === release.manifest.priceAtomic, `preview ${preview.decision}, purchasable at ${preview.priceAtomic}`);

    step("lemma_purchase_resolution (x402 exact, settled on the fork)");
    const providerBefore = await balanceOf(accounts.provider.address);
    const buyerBefore = await balanceOf(accounts.buyer.address);
    let challengedAmount = "";
    const paying = createx402MCPClient({
      name: "e2e-buyer",
      version: "0.0.0",
      schemes: [{ network: "eip155:421614", client: new ExactEvmScheme(accounts.buyer) }],
      autoPayment: true,
      onPaymentRequested: ({ paymentRequired }) => {
        challengedAmount = paymentRequired.accepts[0]?.amount ?? "";
        return challengedAmount === preview.priceAtomic; // local spend policy: exact price only
      },
    });
    await paying.connect(new StreamableHTTPClientTransport(mcpUrl));
    cleanups.push(() => paying.close());
    const paid = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: accounts.buyer.address });
    const text = (paid.content[0] as { text?: string } | undefined)?.text ?? "";
    if (paid.isError === true) throw new Error(`purchase failed: ${text}`);
    check(challengedAmount === preview.priceAtomic, "x402 challenge amount equals preview price");
    check(paid.paymentMade, "payment made");
    const settleTx = paid.paymentResponse?.transaction as Hex | undefined;
    if (settleTx === undefined) throw new Error("no settlement transaction");
    const settleReceipt = await pub.getTransactionReceipt({ hash: settleTx });
    check(settleReceipt.status === "success", `settlement tx ${settleTx} mined on fork (from facilitator ${settleReceipt.from})`);
    check(settleReceipt.from.toLowerCase() === accounts.facilitator.address.toLowerCase(), "settlement submitted by the facilitator key");
    check((await balanceOf(accounts.provider.address)) - providerBefore === price, "provider received exactly the price in USDC");
    check(buyerBefore - (await balanceOf(accounts.buyer.address)) === price, "buyer paid exactly the price");

    const body = JSON.parse(text) as { resolution: unknown; voucher: unknown };
    const resolution = CompatibilityResolution.parse(body.resolution);
    const voucher = SignedResolutionVoucher.parse(body.voucher);
    check(resolution.paymentHash === settleTx.toLowerCase() && voucher.voucher.paymentHash === resolution.paymentHash, "paymentHash = settlement tx hash");
    check(bundleDigest(resolution.bundle) === voucher.voucher.payloadDigest, "payloadDigest = bundleDigest(bundle)");
    const signer = await recoverTypedDataAddress({ ...voucherTypedData(lemmaDomain(registry, 421614), voucher.voucher), signature: voucher.signature as Hex });
    check(signer === accounts.provider.address, "voucher signed by provider (core EIP-712 helpers)");
    const onchainHash = await pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "hashVoucher", args: [voucherTypedMessage(voucher.voucher)] });
    const { hashTypedData } = await import("viem");
    check(onchainHash === hashTypedData(voucherTypedData(lemmaDomain(registry, 421614), voucher.voucher)), "registry hashVoucher matches core typed-data hash");

    step("activateResolution onchain (buyer)");
    await send(
      wallet("buyer").writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "activateResolution", args: [voucherTypedMessage(voucher.voucher), voucher.signature as Hex] }),
    );
    const warranty = await pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getWarranty", args: [resolution.resolutionId as Hex] });
    check(warranty.status === 1 && warranty.amount === price, "warranty Active with amount = price");
    check(await pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "paymentHashUsed", args: [settleTx] }), "payment hash consumed onchain");

    step("lemma_recover_resolution (no second payment)");
    const recovered = await free.callTool({ name: "lemma_recover_resolution", arguments: { previewId: preview.previewId, buyer: accounts.buyer.address } });
    check(JSON.stringify(recovered.structuredContent) === JSON.stringify(body), "recovery returns the identical resolution and voucher");
    check(buyerBefore - (await balanceOf(accounts.buyer.address)) === price, "buyer still charged exactly once");
    const again = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: accounts.buyer.address });
    check(again.isError === true && !again.paymentMade, "second purchase refused before payment");

    step("lemma_submit_receipt");
    const receipt = {
      schemaVersion: "1" as const,
      resolutionId: resolution.resolutionId,
      outcome: "passed" as const,
      testSummary: { passed: 1, failed: 0, skipped: 0, durationMs: 1000, exitCode: 0 },
      filesChanged: resolution.bundle.operations.length,
      evidenceDigest: keccak256(new TextEncoder().encode("e2e-fork evidence")),
      buyer: accounts.buyer.address,
      signedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    };
    const signature = await accounts.buyer.signMessage({ message: { raw: adoptionReceiptDigest(receipt) } });
    const submitted = await free.callTool({ name: "lemma_submit_receipt", arguments: { schemaVersion: "1", receipt, signature } });
    check(submitted.isError !== true, "receipt accepted");
    const summary = (await (await fetch(`${baseUrl}/api/v1/resolutions/${resolution.resolutionId}`)).json()) as Record<string, unknown>;
    check(summary.status === "settled" && !JSON.stringify(summary).includes("contentBase64"), "read API shows settled resolution without bundle");

    step("E2E PASSED");
    info(`registry=${registry} settleTx=${settleTx} resolutionId=${resolution.resolutionId}`);
  } finally {
    for (const c of cleanups.reverse()) {
      try {
        await c();
      } catch {
        /* best effort */
      }
    }
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`\nE2E FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
