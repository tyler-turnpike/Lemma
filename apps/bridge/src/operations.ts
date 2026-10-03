import {
  LEMMA_SCHEMA_VERSION,
  Preview,
  SignedAdoptionReceipt,
  TaskRequest,
  adoptionReceiptDigest,
  bundleDigest,
  digest,
  formatUsdc,
  isPriceJustified,
  keccakString,
  type AdoptionReceipt,
  type Preview as PreviewT,
  type TaskKind,
} from "@lemma/core";
import { ApplyError, applyBundle, runAcceptance, summarizeVitestOutput, type ApplyResult } from "@lemma/core/node";
import { formatEther, type Address, type Hex, type LocalAccount } from "viem";

import { readBalances, skippedActivation, type WalletBalances, type WarrantyActivator } from "./chain.js";
import type { BridgeConfig } from "./config.js";
import { BridgeError, errorMessage } from "./errors.js";
import type { SpendLedger } from "./ledger.js";
import { PaymentGuard, precheckSpend, type PaymentExpectation } from "./policy.js";
import { buildWorkspaceProfile, type ProfileFileReader } from "./profile.js";
import type { Logger } from "./redaction.js";
import { PaymentRejectedError, RemoteToolError, type RemoteLemma } from "./remote.js";
import type { StateStore, StoredResolution } from "./state.js";
import { verifyPurchase } from "./verify.js";
import { WorkspaceResolver } from "./workspace.js";

export type BridgeDeps = {
  config: BridgeConfig;
  buyer: LocalAccount | null;
  remote: RemoteLemma;
  ledger: SpendLedger;
  store: StateStore;
  activator: WarrantyActivator | null;
  log: Logger;
  clock?: () => Date;
  purchaseTimeoutMs?: number;
  recoverTimeoutMs?: number;
  recoverAttempts?: number;
  recoverDelayMs?: number;
  profileReader?: ProfileFileReader;
  /** Environment for acceptance runs (only allowlisted names are forwarded by core). */
  acceptanceEnv?: NodeJS.ProcessEnv;
  /**
   * Reads the server's public configuration (GET /api/v1/status). Used only to refuse a purchase
   * before paying when the server signs vouchers for a different registry. Returns null when
   * unavailable, in which case the post-payment voucher check still applies.
   */
  serverStatus?: () => Promise<{ registry: string | null } | null>;
  /** Effective workspace (env, client roots, cwd). Defaults to the validated config workspace. */
  workspace?: WorkspaceResolver;
  /** Where the buyer key came from; a burner lives in a local file. */
  walletSource?: { kind: "env" } | { kind: "burner"; file: string };
  /** Reads on-chain balances for lemma_wallet. Defaults to the configured RPC. */
  balances?: (address: Address) => Promise<WalletBalances>;
};

export const FUNDING_LINKS = {
  usdcFaucet: "https://faucet.circle.com",
  ethFaucet: "https://www.alchemy.com/faucets/arbitrum-sepolia",
} as const;

export type WalletResult = {
  address: Address | null;
  network: BridgeConfig["network"];
  chainId: BridgeConfig["chainId"];
  usdcAddress: Address;
  balances: { usdc: string; usdcAtomic: string; eth: string; wei: string } | null;
  balanceNote: string | null;
  wallet: { kind: "burner"; file: string } | { kind: "env"; file: null } | { kind: "none"; file: null };
  caps: { perResolutionUsdc: string; dailyUsdc: string };
  spentTodayUsdc: string;
  remainingTodayUsdc: string;
  funding: { usdcFaucet: string; usdcFaucetNote: string; ethFaucet: string };
};

export type PreviewResult = {
  preview: PreviewT;
  local: {
    priceUsdc: string | null;
    withinPerResolutionCap: boolean | null;
    spentTodayUsdc: string;
    dailyCapUsdc: string;
    priceJustifiedByEvidence: boolean | null;
    purchaseAllowedByLocalPolicy: boolean;
    policyReasons: string[];
  };
};

export type BuyResult = {
  status: "purchased" | "recovered" | "already-owned";
  previewId: string;
  resolutionId: string;
  release: string;
  priceAtomic: string;
  priceUsdc: string;
  paymentHash: string;
  payloadDigest: string;
  voucherSigner: string;
  activation: StoredResolution["activation"];
  files: Array<{ path: string; op: "create" | "modify" }>;
  dependencyAdditions: { dependencies: Record<string, string>; devDependencies: Record<string, string> };
};

export type AdoptionResult = {
  resolutionId: string;
  outcome: AdoptionReceipt["outcome"];
  receipt: AdoptionReceipt;
  steps: Array<{ argv: string[]; exitCode: number | null; timedOut: boolean; durationMs: number; outputTail: string }>;
  submitted: boolean;
  receiptId: string | null;
  submitError: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Bridge {
  private readonly clock: () => Date;
  private readonly workspaceResolver: WorkspaceResolver;
  constructor(private readonly deps: BridgeDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.workspaceResolver = deps.workspace ?? new WorkspaceResolver(deps.config);
  }

  /** The validated workspace; refuses /, $HOME and unexpanded placeholders. */
  workspace(): Promise<string> {
    return this.workspaceResolver.get();
  }

  private requireBuyer(): LocalAccount {
    if (this.deps.buyer === null) throw new BridgeError("config", "BUYER_PRIVATE_KEY is not configured; purchases and receipts are disabled");
    return this.deps.buyer;
  }

  private requireProvider(): Address {
    const p = this.deps.config.providerAddress;
    if (p === null) throw new BridgeError("config", "LEMMA_PROVIDER_ADDRESS is not configured; cannot verify payTo or voucher signer");
    return p;
  }

  // -------------------------------------------------------------------------
  // Wallet (free, read-only)
  // -------------------------------------------------------------------------

  async wallet(): Promise<WalletResult> {
    const { config, ledger, buyer } = this.deps;
    const spent = await ledger.spentOn(this.clock());
    const address = buyer?.address ?? null;
    let balances: WalletResult["balances"] = null;
    let balanceNote: string | null = null;
    if (address === null) balanceNote = "no buyer wallet configured";
    else if (this.deps.balances === undefined && config.rpcUrl === null) balanceNote = "ARBITRUM_SEPOLIA_RPC_URL is not configured; balances unavailable";
    else {
      try {
        const read = this.deps.balances ?? ((a: Address) => readBalances(config.rpcUrl as string, config.usdcAddress, a));
        const b = await read(address);
        balances = { usdc: formatUsdc(b.usdcAtomic), usdcAtomic: b.usdcAtomic.toString(), eth: formatEther(b.wei), wei: b.wei.toString() };
      } catch (error) {
        balanceNote = `could not read balances from the RPC (${errorMessage(error).slice(0, 200)}); try again later`;
      }
    }
    const source = this.deps.walletSource;
    return {
      address,
      network: config.network,
      chainId: config.chainId,
      usdcAddress: config.usdcAddress,
      balances,
      balanceNote,
      wallet: address === null ? { kind: "none", file: null } : source?.kind === "burner" ? { kind: "burner", file: source.file } : { kind: "env", file: null },
      caps: { perResolutionUsdc: formatUsdc(config.perResolutionCapAtomic), dailyUsdc: formatUsdc(config.dailyCapAtomic) },
      spentTodayUsdc: formatUsdc(spent),
      remainingTodayUsdc: formatUsdc(spent >= config.dailyCapAtomic ? 0n : config.dailyCapAtomic - spent),
      funding: { usdcFaucet: FUNDING_LINKS.usdcFaucet, usdcFaucetNote: "select Arbitrum Sepolia", ethFaucet: FUNDING_LINKS.ethFaucet },
    };
  }

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  async preview(kind: TaskKind): Promise<PreviewResult> {
    const { config, remote, store, ledger } = this.deps;
    const task = TaskRequest.parse({ schemaVersion: LEMMA_SCHEMA_VERSION, kind, network: "arbitrum-sepolia" });
    const profile = await buildWorkspaceProfile(await this.workspace(), this.deps.profileReader);
    const raw = await remote.preview({ task, profile });
    const parsed = Preview.safeParse(raw);
    if (!parsed.success) throw new BridgeError("remote", "server returned an invalid preview", parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`));
    const preview = parsed.data;
    if (preview.task.kind !== task.kind || preview.task.network !== task.network) throw new BridgeError("remote", "server preview is for a different task");
    await store.savePreview({ preview, task, profile, storedAt: this.clock().toISOString() });

    const now = this.clock();
    const spent = await ledger.spentOn(now);
    const price = preview.priceAtomic === null ? null : BigInt(preview.priceAtomic);
    let reasons: string[] = [];
    if (!preview.purchasable || price === null) reasons.push("preview is not purchasable");
    else if (config.providerAddress === null) reasons.push("LEMMA_PROVIDER_ADDRESS is not configured");
    else if (this.deps.buyer === null) reasons.push("BUYER_PRIVATE_KEY is not configured");
    else reasons = precheckSpend(this.expectation(preview, this.deps.buyer.address, config.providerAddress), spent, now);
    return {
      preview,
      local: {
        priceUsdc: price === null ? null : formatUsdc(price),
        withinPerResolutionCap: price === null ? null : price <= config.perResolutionCapAtomic,
        spentTodayUsdc: formatUsdc(spent),
        dailyCapUsdc: formatUsdc(config.dailyCapAtomic),
        priceJustifiedByEvidence: price === null ? null : isPriceJustified(price, preview.expectedSavingAtomic === null ? null : BigInt(preview.expectedSavingAtomic)),
        purchaseAllowedByLocalPolicy: reasons.length === 0,
        policyReasons: reasons,
      },
    };
  }

  private expectation(preview: PreviewT, buyer: Address, provider: Address): PaymentExpectation {
    const { config } = this.deps;
    return {
      previewId: preview.previewId,
      buyer,
      priceAtomic: BigInt(preview.priceAtomic ?? "0"),
      network: config.network,
      usdcAddress: config.usdcAddress,
      payTo: provider,
      perResolutionCapAtomic: config.perResolutionCapAtomic,
      dailyCapAtomic: config.dailyCapAtomic,
    };
  }

  // -------------------------------------------------------------------------
  // Buy (pay once, recover otherwise, verify, activate, persist)
  // -------------------------------------------------------------------------

  async buy(previewId: string): Promise<BuyResult> {
    const { store, ledger, remote, log } = this.deps;
    const buyer = this.requireBuyer();
    const provider = this.requireProvider();
    const stored = await store.loadPreview(previewId);
    if (stored === null) throw new BridgeError("not-found", "unknown previewId; call lemma_preview first");
    const preview = stored.preview;
    if (!preview.purchasable || preview.priceAtomic === null || preview.releaseId === null) {
      throw new BridgeError("policy", `preview decision is "${preview.decision}" and is not purchasable`);
    }

    const owned = await store.loadResolutionByPreview(previewId);
    if (owned !== null) return this.finishOwned(owned);

    const exp = this.expectation(preview, buyer.address, provider);
    const args = { previewId, buyer: buyer.address };
    if ((await ledger.get(previewId)) !== null) {
      // A payment was authorized earlier (lost response or restart). Never pay again.
      log.warn("spend already recorded for preview; recovering instead of paying", { previewId });
      return this.finishPurchase(await this.recoverWithRetry(args, null), stored.preview, "recovered");
    }

    const now = this.clock();
    const reasons = precheckSpend(exp, await ledger.spentOn(now), now);
    if (reasons.length > 0) throw new BridgeError("policy", "purchase refused by local spend policy", reasons);

    await this.assertSameRegistry();

    const guard = new PaymentGuard(exp, ledger, this.clock);
    let payload: unknown;
    let status: BuyResult["status"] = "purchased";
    try {
      const out = await remote.purchase(args, guard, this.deps.purchaseTimeoutMs ?? 120_000);
      payload = out.payload;
    } catch (error) {
      if (!guard.paymentAuthorized) {
        if (guard.refusals.length > 0) throw new BridgeError("policy", "payment refused by local spend policy", guard.refusals);
        if (error instanceof RemoteToolError && (error.serverCode === "already_settled" || /lemma_recover_resolution/.test(error.serverMessage))) {
          // Server says this (previewId, buyer) is already settled.
          payload = await this.recoverWithRetry(args, null);
          status = "recovered";
        } else {
          throw error instanceof BridgeError ? error : new BridgeError("remote", `purchase failed before any payment was signed: ${errorMessage(error)}`);
        }
      } else if (error instanceof PaymentRejectedError && !error.duringSettlement) {
        // The server's x402 verification refused the signed authorization (e.g. insufficient
        // USDC balance): nothing was settled. Confirm with one recovery probe, then release the
        // local spend so the buyer can fix the cause and buy again without hitting the cap.
        const confirmed = await this.deps.remote.recover(args, this.deps.recoverTimeoutMs ?? 30_000).catch(() => null);
        if (confirmed !== null && (confirmed as { found?: unknown }).found !== false) {
          payload = confirmed;
          status = "recovered";
        } else {
          const voided = confirmed !== null && (await ledger.voidAuthorization(previewId));
          log.warn("payment rejected before settlement", { previewId, reason: error.reason, spendReleased: voided });
          const next = /insufficient_balance/.test(error.reason) ? "Fund the buyer wallet with Arbitrum Sepolia USDC, then call" : "Fix the cause and call";
          throw new BridgeError(
            "payment",
            `the server rejected the payment before settlement (${error.reason}); no funds moved${voided ? " and the local spend was released" : ""}. ${next} lemma_buy_resolution again`,
          );
        }
      } else {
        // A payment may have been sent. Never re-pay: recover the settled resolution.
        log.warn("purchase response lost after payment authorization; recovering", { previewId, error: errorMessage(error) });
        payload = await this.recoverWithRetry(args, error instanceof RemoteToolError ? error.serverMessage : errorMessage(error));
        status = "recovered";
      }
    }
    return this.finishPurchase(payload, preview, status);
  }

  /** Refuses before payment when the server's voucher registry differs from the local one. */
  private async assertSameRegistry(): Promise<void> {
    const local = this.deps.config.registryAddress;
    if (local === null || this.deps.serverStatus === undefined) return;
    const status = await this.deps.serverStatus().catch(() => null);
    const remote = status?.registry ?? null;
    if (remote !== null && remote.toLowerCase() !== local.toLowerCase()) {
      throw new BridgeError(
        "config",
        `the Lemma server signs warranty vouchers for registry ${remote}, but this bridge is configured with RESOLUTION_WARRANTY_REGISTRY_ADDRESS=${local}; refusing to pay. Fix the bridge configuration`,
      );
    }
  }

  private async recoverWithRetry(args: { previewId: string; buyer: string }, cause: string | null): Promise<unknown> {
    const attempts = this.deps.recoverAttempts ?? 5;
    const delay = this.deps.recoverDelayMs ?? 3_000;
    let last = "";
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(delay * i);
      try {
        const raw = await this.deps.remote.recover(args, this.deps.recoverTimeoutMs ?? 30_000);
        if (typeof raw === "object" && raw !== null && (raw as { found?: unknown }).found === false) {
          last = "server has no settled resolution for this preview yet";
          continue;
        }
        return raw;
      } catch (error) {
        last = errorMessage(error);
      }
    }
    throw new BridgeError(
      "recovery",
      "could not recover the purchase; no second payment was made. Retry lemma_buy_resolution later to recover again, or request a new preview if the payment never settled",
      [last, ...(cause !== null ? [`original error: ${cause.slice(0, 300)}`] : [])],
    );
  }

  private async finishPurchase(payload: unknown, preview: PreviewT, status: BuyResult["status"]): Promise<BuyResult> {
    const { store, ledger, config, log } = this.deps;
    const buyer = this.requireBuyer();
    let verified;
    try {
      verified = await verifyPurchase(payload, {
        preview,
        buyer: buyer.address,
        providerAddress: this.requireProvider(),
        chainId: config.chainId,
        registryAddress: config.registryAddress,
      });
    } catch (error) {
      const reasons = error instanceof BridgeError ? error.details : [errorMessage(error)];
      const file = await store.quarantine(preview.previewId, payload, reasons).catch(() => null);
      log.error("delivered resolution rejected", { previewId: preview.previewId, reasons, quarantined: file });
      throw error;
    }
    const { resolution, voucher } = verified;
    const record: StoredResolution = { resolution, voucher, activation: null, apply: null, receipt: null, storedAt: this.clock().toISOString() };
    await store.saveResolution(record);
    await ledger.settle(preview.previewId, BigInt(resolution.priceAtomic), resolution.paymentHash, resolution.resolutionId, this.clock());
    record.activation = await this.activate(record);
    await store.saveResolution(record);
    return this.summarize(record, status);
  }

  private async activate(record: StoredResolution): Promise<NonNullable<StoredResolution["activation"]>> {
    const activator = this.deps.activator;
    const activation = activator === null ? skippedActivation("no warranty activator configured") : await activator.activate(record.voucher);
    if (activation.status === "skipped" || activation.status === "failed") {
      this.deps.log.warn(`warranty activation ${activation.status}`, { resolutionId: record.resolution.resolutionId, reason: activation.reason });
    }
    return activation;
  }

  private async finishOwned(record: StoredResolution): Promise<BuyResult> {
    const status = record.activation?.status;
    if (status !== "activated" && status !== "already-active") {
      record.activation = await this.activate(record);
      await this.deps.store.saveResolution(record);
    }
    return this.summarize(record, "already-owned");
  }

  private summarize(record: StoredResolution, status: BuyResult["status"]): BuyResult {
    const r = record.resolution;
    return {
      status,
      previewId: r.previewId,
      resolutionId: r.resolutionId,
      release: r.release,
      priceAtomic: r.priceAtomic,
      priceUsdc: formatUsdc(BigInt(r.priceAtomic)),
      paymentHash: r.paymentHash,
      payloadDigest: r.payloadDigest,
      voucherSigner: record.voucher.signer,
      activation: record.activation,
      files: r.bundle.operations.map((op) => ({ path: op.path, op: op.op })),
      dependencyAdditions: r.bundle.dependencyAdditions,
    };
  }

  // -------------------------------------------------------------------------
  // Apply
  // -------------------------------------------------------------------------

  private async loadVerified(resolutionId: string): Promise<StoredResolution> {
    const record = await this.deps.store.loadResolution(resolutionId);
    if (record === null) throw new BridgeError("not-found", "unknown resolutionId; buy it first with lemma_buy_resolution");
    if (bundleDigest(record.resolution.bundle) !== record.resolution.payloadDigest || record.resolution.payloadDigest !== record.voucher.voucher.payloadDigest) {
      throw new BridgeError("verification", "stored bundle no longer matches its signed payload digest; refusing to use it");
    }
    return record;
  }

  async apply(resolutionId: string, write: boolean): Promise<ApplyResult> {
    const record = await this.loadVerified(resolutionId);
    const workspace = await this.workspace();
    let result: ApplyResult;
    try {
      result = await applyBundle(workspace, record.resolution.bundle, { dryRun: !write });
    } catch (error) {
      if (error instanceof ApplyError) throw new BridgeError("apply", `${error.code}: ${error.message}`);
      throw error;
    }
    if (write) {
      record.apply = { filesChanged: result.filesChanged, at: this.clock().toISOString() };
      await this.deps.store.saveResolution(record);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Verify adoption (acceptance + signed receipt)
  // -------------------------------------------------------------------------

  async verifyAdoption(resolutionId: string): Promise<AdoptionResult> {
    const buyer = this.requireBuyer();
    const record = await this.loadVerified(resolutionId);
    const workspace = await this.workspace();
    let check: ApplyResult;
    try {
      check = await applyBundle(workspace, record.resolution.bundle, { dryRun: true });
    } catch (error) {
      throw new BridgeError("acceptance", `workspace does not contain the applied resolution (${errorMessage(error)}); run lemma_apply_resolution with apply: true first`);
    }
    if (check.changes.some((c) => c.status !== "unchanged") || check.dependencyChanges.length > 0) {
      throw new BridgeError("acceptance", "resolution is not fully applied; run lemma_apply_resolution with apply: true first");
    }

    const run = await runAcceptance(workspace, record.resolution.acceptance, { env: this.deps.acceptanceEnv ?? process.env });
    const totals = { passed: 0, failed: 0, skipped: 0 };
    for (const step of run.steps) {
      const s = summarizeVitestOutput(step.output);
      totals.passed += s.passed;
      totals.failed += s.failed;
      totals.skipped += s.skipped;
    }
    const lastStep = run.steps[run.steps.length - 1];
    const evidenceDigest = digest({
      schemaVersion: LEMMA_SCHEMA_VERSION,
      resolutionId,
      payloadDigest: record.resolution.payloadDigest,
      passed: run.passed,
      steps: run.steps.map((s) => ({ argv: s.argv, exitCode: s.exitCode, timedOut: s.timedOut, durationMs: s.durationMs, outputDigest: keccakString(s.output) })),
    });
    const receipt: AdoptionReceipt = {
      schemaVersion: LEMMA_SCHEMA_VERSION,
      resolutionId,
      outcome: run.passed ? "passed" : "failed",
      testSummary: { ...totals, durationMs: Math.max(0, Math.round(run.durationMs)), exitCode: lastStep?.exitCode ?? null },
      filesChanged: record.apply?.filesChanged ?? check.changes.length,
      evidenceDigest,
      buyer: buyer.address,
      signedAt: this.clock().toISOString(),
    };
    const signature = await buyer.signMessage({ message: { raw: adoptionReceiptDigest(receipt) as Hex } });
    const signed = SignedAdoptionReceipt.parse({ schemaVersion: LEMMA_SCHEMA_VERSION, receipt, signature });

    let submitted = false;
    let receiptId: string | null = null;
    let submitError: string | null = null;
    try {
      const res = (await this.deps.remote.submitReceipt(signed)) as { accepted?: unknown; receiptId?: unknown };
      submitted = res?.accepted === true;
      receiptId = typeof res?.receiptId === "string" ? res.receiptId : null;
      if (!submitted) submitError = "server did not accept the receipt";
    } catch (error) {
      submitError = errorMessage(error);
    }
    record.receipt = { signed, submitted, receiptId };
    await this.deps.store.saveResolution(record);
    return {
      resolutionId,
      outcome: receipt.outcome,
      receipt,
      steps: run.steps.map((s) => ({ argv: s.argv, exitCode: s.exitCode, timedOut: s.timedOut, durationMs: s.durationMs, outputTail: s.output.slice(-2000) })),
      submitted,
      receiptId,
      submitError,
    };
  }
}
