import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadCatalog } from "@lemma/catalog";
import { Preview, newResolutionId, type CompatibilityResolution, type TaskRequest } from "@lemma/core";
import { afterAll, beforeAll, describe, expect, it as vitestIt } from "vitest";

import { createApp } from "../src/app.js";
import { silentLogger } from "../src/log.js";
import { MemoryRepository } from "../src/repository/memory.js";
import { runMigrations } from "../src/repository/migrate.js";
import { PostgresRepository } from "../src/repository/postgres.js";
import { RepositoryConflictError, type Repository } from "../src/repository/types.js";
import { resolve } from "../src/resolver.js";
import { FakeFacilitator, connectMcp, connectPayingMcp, makeConfig, makeKeys, toolJson } from "./helpers.js";

const catalog = loadCatalog();
const task: TaskRequest = { schemaVersion: "1", kind: "x402-paywall-mcp-server", network: "arbitrum-sepolia" };
const profile = catalog.fixtureProfile("mcp-server-exact");
const BUYER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const hex32 = () => newResolutionId();

function freshPreview() {
  const p = resolve(task, profile, catalog, new Date(), { allowProvisional: true });
  return Preview.parse({ ...p, previewId: hex32() });
}

function resolutionFor(r: { resolutionId: string; previewId: string; releaseId: string; release: string }, tx: string): CompatibilityResolution {
  const loaded = catalog.getRelease(r.release)!;
  return {
    schemaVersion: "1",
    resolutionId: r.resolutionId,
    previewId: r.previewId,
    releaseId: r.releaseId,
    release: r.release,
    buyer: BUYER,
    priceAtomic: "120000",
    paymentHash: tx,
    payloadDigest: loaded.payloadDigest,
    bundle: loaded.bundle,
    acceptance: loaded.manifest.acceptance,
    issuedAt: "2026-10-02T12:00:00Z",
    expiresAt: "2026-10-03T12:00:00Z",
  } as CompatibilityResolution;
}

function repositoryContract(name: string, make: () => Repository | undefined) {
  describe(`${name} repository contract`, () => {
    // Skip (rather than fail) when the backing store could not be started.
    const it = (title: string, fn: () => Promise<void>) =>
      vitestIt(title, async (ctx) => {
        if (make() === undefined) return ctx.skip();
        await fn();
      });
    const repo = () => {
      const r = make();
      if (r === undefined) throw new Error("repository unavailable");
      return r;
    };

    it("stores previews idempotently", async () => {
      const preview = freshPreview();
      const now = new Date("2026-10-02T12:00:00Z");
      await repo().savePreview({ preview, expiresAt: new Date(now.getTime() + 1000), createdAt: now });
      await repo().savePreview({ preview: { ...preview, reasons: ["changed"] }, expiresAt: now, createdAt: now });
      const got = await repo().getPreview(preview.previewId);
      expect(got?.preview).toEqual(preview);
      expect(got?.expiresAt.getTime()).toBe(now.getTime() + 1000);
      expect(await repo().getPreview(hex32())).toBeUndefined();
    });

    it("enforces one resolution per (previewId, buyer) and settles exactly once", async () => {
      const preview = freshPreview();
      const now = new Date("2026-10-02T12:00:00Z");
      await repo().savePreview({ preview, expiresAt: now, createdAt: now });
      const base = { previewId: preview.previewId as `0x${string}`, buyer: BUYER, release: preview.release!, releaseId: preview.releaseId as `0x${string}`, priceAtomic: "120000", createdAt: now };
      const a = await repo().getOrCreatePendingResolution({ ...base, resolutionId: hex32() });
      const b = await repo().getOrCreatePendingResolution({ ...base, resolutionId: hex32() });
      expect(b.resolutionId).toBe(a.resolutionId);
      expect(a.status).toBe("pending");

      const tx = hex32();
      const settlement = { txHash: tx, resolutionId: a.resolutionId, network: "eip155:421614", payer: BUYER, amountAtomic: "120000", settledAt: now };
      const settled = await repo().settleResolution({ settlement, resolution: resolutionFor(a, tx) });
      expect(settled.status).toBe("settled");
      expect(settled.paymentHash).toBe(tx);
      expect(settled.resolution?.bundle).toEqual(catalog.getRelease(a.release)!.bundle);
      // Same tx again: idempotent.
      expect((await repo().settleResolution({ settlement, resolution: resolutionFor(a, tx) })).paymentHash).toBe(tx);
      // A different tx for a settled resolution is a conflict.
      const tx2 = hex32();
      await expect(repo().settleResolution({ settlement: { ...settlement, txHash: tx2 }, resolution: resolutionFor(a, tx2) })).rejects.toBeInstanceOf(RepositoryConflictError);
      expect(await repo().getSettlement(tx)).toMatchObject({ resolutionId: a.resolutionId, amountAtomic: "120000" });
      expect(await repo().getSettlementForResolution(a.resolutionId)).toMatchObject({ txHash: tx });
      expect((await repo().getResolutionByPreviewBuyer(preview.previewId, BUYER))?.status).toBe("settled");

      // The same tx hash cannot settle a different resolution.
      const other = await repo().getOrCreatePendingResolution({ ...base, buyer: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", resolutionId: hex32() });
      await expect(
        repo().settleResolution({ settlement: { ...settlement, resolutionId: other.resolutionId }, resolution: resolutionFor(other, tx) }),
      ).rejects.toBeInstanceOf(RepositoryConflictError);
    });

    it("keeps the first voucher, dedupes receipts by digest, and stores cursors", async () => {
      const preview = freshPreview();
      const now = new Date("2026-10-02T12:00:00Z");
      await repo().savePreview({ preview, expiresAt: now, createdAt: now });
      const r = await repo().getOrCreatePendingResolution({
        resolutionId: hex32(),
        previewId: preview.previewId as `0x${string}`,
        buyer: BUYER,
        release: preview.release!,
        releaseId: preview.releaseId as `0x${string}`,
        priceAtomic: "120000",
        createdAt: now,
      });
      const signed = (sig: string) =>
        ({
          schemaVersion: "1",
          chainId: 421614,
          verifyingContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
          signer: BUYER,
          signature: sig,
          voucher: { resolutionId: r.resolutionId, releaseId: r.releaseId, buyer: BUYER, amount: "120000", paymentHash: hex32(), payloadDigest: hex32(), expiresAt: "1" },
        }) as const;
      const first = await repo().saveVoucher({ resolutionId: r.resolutionId, signed: signed(`0x${"11".repeat(65)}`), createdAt: now });
      const second = await repo().saveVoucher({ resolutionId: r.resolutionId, signed: signed(`0x${"22".repeat(65)}`), createdAt: now });
      expect(second.signed.signature).toBe(first.signed.signature);

      const digest = hex32();
      const receipt = {
        receiptId: hex32(),
        resolutionId: r.resolutionId,
        buyer: BUYER,
        outcome: "passed" as const,
        digest,
        signed: {
          schemaVersion: "1" as const,
          signature: `0x${"33".repeat(65)}`,
          receipt: {
            schemaVersion: "1" as const,
            resolutionId: r.resolutionId,
            outcome: "passed" as const,
            testSummary: { passed: 1, failed: 0, skipped: 0, durationMs: 1, exitCode: 0 },
            filesChanged: 1,
            evidenceDigest: hex32(),
            buyer: BUYER,
            signedAt: "2026-10-02T12:00:00Z",
          },
        },
        createdAt: now,
      };
      const a = await repo().saveAdoptionReceipt(receipt);
      const b = await repo().saveAdoptionReceipt({ ...receipt, receiptId: hex32() });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(b.record.receiptId).toBe(a.record.receiptId);
      expect(await repo().listAdoptionReceipts(r.resolutionId)).toHaveLength(1);

      await repo().setChainCursor({ chainId: 421614, stream: "registry", blockNumber: 10n, logIndex: 2, updatedAt: now });
      await repo().setChainCursor({ chainId: 421614, stream: "registry", blockNumber: 12n, logIndex: 0, updatedAt: now });
      expect(await repo().getChainCursor(421614, "registry")).toMatchObject({ blockNumber: 12n, logIndex: 0 });
      expect(await repo().ping()).toBe(true);
    });
  });
}

const memory = new MemoryRepository();
repositoryContract("memory", () => memory);

// ---------------------------------------------------------------------------
// Throwaway Postgres 16 cluster (skipped when the binaries are unavailable)
// ---------------------------------------------------------------------------

const PG_BIN = process.env.LEMMA_PG_BIN ?? "/usr/lib/postgresql/16/bin";
const pgAvailable = existsSync(join(PG_BIN, "initdb")) && existsSync(join(PG_BIN, "pg_ctl"));
const isRoot = process.getuid?.() === 0;

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

function pgCmd(bin: string, args: string[]) {
  // initdb refuses to run as root; drop to the postgres user when needed.
  const [cmd, argv] = isRoot ? ["runuser", ["-u", "postgres", "--", join(PG_BIN, bin), ...args]] : [join(PG_BIN, bin), args];
  return spawnSync(cmd, argv as string[], { encoding: "utf8", timeout: 60_000 });
}

let pgUrl: string | undefined;
let pgDir: string | undefined;
let pgRepo: PostgresRepository | undefined;

const pg = describe.skipIf(!pgAvailable);
pg("postgres (throwaway cluster)", () => {
  beforeAll(async () => {
    try {
      await startCluster();
    } catch (error) {
      process.stderr.write(`skipping postgres integration: ${(error as Error).message}\n`);
      pgRepo = undefined;
    }
  }, 120_000);

  const startCluster = async () => {
    pgDir = mkdtempSync(join(tmpdir(), "lemma-pg-"));
    if (isRoot) execFileSync("chown", ["-R", "postgres:postgres", pgDir]);
    const data = join(pgDir, "data");
    const init = pgCmd("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-sync"]);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
    const port = await freePort();
    const start = pgCmd("pg_ctl", ["-D", data, "-l", join(pgDir, "log"), "-w", "-o", `-p ${port} -k ${pgDir} -c listen_addresses=127.0.0.1 -c fsync=off`, "start"]);
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stderr}`);
    pgUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
    expect(await runMigrations(pgUrl)).toEqual(["0001_init"]);
    expect(await runMigrations(pgUrl)).toEqual([]);
    pgRepo = new PostgresRepository(pgUrl, { max: 4 });
  };

  afterAll(async () => {
    await pgRepo?.close();
    if (pgDir !== undefined) {
      pgCmd("pg_ctl", ["-D", join(pgDir, "data"), "-m", "immediate", "stop"]);
      rmSync(pgDir, { recursive: true, force: true });
    }
  });

  repositoryContract("postgres", () => pgRepo);

  vitestIt("runs the full paid flow against Postgres", async (ctx) => {
    if (pgRepo === undefined) return ctx.skip();
    const keys = makeKeys();
    const facilitator = new FakeFacilitator();
    const { app } = createApp({ config: makeConfig(keys), repo: pgRepo!, catalog, logger: silentLogger, webDistDir: null, facilitatorClient: facilitator });
    const free = await connectMcp(app);
    const preview = Preview.parse((await free.callTool({ name: "lemma_preview", arguments: { task, profile } })).structuredContent);
    const paying = await connectPayingMcp(app, keys.buyer);
    const result = await paying.callTool("lemma_purchase_resolution", { previewId: preview.previewId, buyer: keys.buyer.address });
    expect(result.isError).toBeFalsy();
    const recovered = await free.callTool({ name: "lemma_recover_resolution", arguments: { previewId: preview.previewId, buyer: keys.buyer.address } });
    expect(recovered.structuredContent).toEqual(toolJson(result));
    expect(facilitator.settleCalls).toHaveLength(1);
    expect((await app.request("/health")).status).toBe(200);
    await free.close();
    await paying.close();
  });
});

