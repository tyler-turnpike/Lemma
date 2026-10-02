/**
 * Evaluator CLI: signs an EIP-712 Outcome with the EVALUATOR key (core typed data) and submits
 * `finalizeOutcome`, or calls `expireResolution` after the claim window.
 *
 *   npm run evaluator -- status   --resolution 0x...
 *   npm run evaluator -- finalize --resolution 0x... --result passed|failed [--evidence 0x...] [--yes]
 *   npm run evaluator -- expire   --resolution 0x... [--yes]
 *
 * Options:
 *   --registry 0x...      default RESOLUTION_WARRANTY_REGISTRY_ADDRESS
 *   --rpc URL             default ARBITRUM_SEPOLIA_RPC_URL
 *   --api URL             Lemma server used to look up the buyer's Adoption Receipt evidence
 *                         when --evidence is omitted (default LEMMA_API_URL)
 *   --dotenv PATH|none     dotenv file read programmatically (default <repo>/.env); exported
 *                         variables win over the file
 *   --yes                 broadcast. Without it the outcome is signed and checked but not sent.
 *   --json                print one JSON result object on stdout instead of narration
 *
 * Env: EVALUATOR_PRIVATE_KEY (checked against EVALUATOR_ADDRESS when set). Secrets are never printed.
 */
import { Bytes32 } from "@lemma/core";
import { getAddress, type Address, type Hex } from "viem";

import { clients, readCredit, readRelease, readWarranty, statusName, usdc } from "./lib/chain.js";
import { PUBLIC_ARBITRUM_SEPOLIA_RPC, REPO_ROOT, Scrubber, loadEnv, optional, required, roleFromEnv } from "./lib/env.js";
import { submitExpire, submitOutcome, signOutcome, finalizeProblems, expireProblems, RESULT, type ResultName } from "./lib/evaluator.js";
import { ARBISCAN, FORK_EXPLORER, Narrator } from "./lib/narrate.js";
import { join } from "node:path";

type Args = { cmd: string; flags: Map<string, string | true> };

function parseArgs(argv: string[]): Args {
  const [cmd = "help", ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(a.slice(2), next);
      i++;
    } else flags.set(a.slice(2), true);
  }
  return { cmd, flags };
}

const USAGE = `usage:
  evaluator status   --resolution 0x<32 bytes>
  evaluator finalize --resolution 0x<32 bytes> --result passed|failed [--evidence 0x<32 bytes>] [--yes]
  evaluator expire   --resolution 0x<32 bytes> [--yes]
options: --registry 0x.. --rpc URL --api URL --dotenv PATH|none --json`;

async function latestReceiptEvidence(api: string, resolutionId: string): Promise<{ evidenceDigest: Hex; outcome: string } | null> {
  const res = await fetch(`${api.replace(/\/+$/, "")}/api/v1/adoption-receipts?resolutionId=${resolutionId}`);
  if (!res.ok) throw new Error(`receipt lookup failed: HTTP ${res.status}`);
  const body = (await res.json()) as { receipts?: Array<{ evidenceDigest: Hex; outcome: string }> };
  const last = body.receipts?.at(-1);
  return last === undefined ? null : last;
}

const scrubber = new Scrubber();

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (cmd === "help" || flags.has("help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const str = (k: string) => {
    const v = flags.get(k);
    return typeof v === "string" ? v : undefined;
  };
  const envFile = str("dotenv");
  const env = loadEnv(envFile === "none" ? null : (envFile ?? join(REPO_ROOT, ".env")));
  scrubber.addFromEnv(env);
  const json = flags.has("json");
  const rpcUrl = str("rpc") ?? required(env, "ARBITRUM_SEPOLIA_RPC_URL");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(rpcUrl) && rpcUrl !== PUBLIC_ARBITRUM_SEPOLIA_RPC) scrubber.add(rpcUrl);
  const narr = new Narrator(scrubber, /^https?:\/\/(127\.0\.0\.1|localhost)/.test(rpcUrl) ? FORK_EXPLORER : ARBISCAN);
  const log = (fn: () => void) => {
    if (!json) fn();
  };

  const registry = getAddress(str("registry") ?? required(env, "RESOLUTION_WARRANTY_REGISTRY_ADDRESS")) as Address;
  const id = Bytes32.safeParse((str("resolution") ?? "").toLowerCase());
  if (!id.success) throw new Error("--resolution must be a 0x-prefixed 32-byte hex id");
  const resolutionId = id.data as Hex;
  const c = clients(rpcUrl);
  const chainId = await c.pub.getChainId();
  if (chainId !== 421614) throw new Error(`RPC chain id is ${chainId}, expected 421614`);

  const w = await readWarranty(c.pub, registry, resolutionId);
  const rel = await readRelease(c.pub, registry, w.releaseId);
  log(() => {
    narr.step("warranty", resolutionId);
    narr.kv("registry", narr.explorer.address(registry));
    narr.kv("status", statusName(w.status));
    if (w.status !== 0) {
      narr.kv("buyer", w.buyer);
      narr.kv("amount", usdc(w.amount));
      narr.kv("claim deadline", new Date(Number(w.claimDeadline) * 1000).toISOString());
      narr.kv("release evaluator", rel.evaluator);
      narr.kv("release bond", `${usdc(rel.availableBond)} available, ${usdc(rel.reservedBond)} reserved`);
    }
  });

  if (cmd === "status") {
    const credit = w.status === 0 ? 0n : await readCredit(c.pub, registry, w.buyer);
    if (json) process.stdout.write(`${JSON.stringify({ resolutionId, status: statusName(w.status), buyer: w.buyer, amount: w.amount.toString(), claimDeadline: Number(w.claimDeadline), buyerCredit: credit.toString(), evidenceDigest: w.evidenceDigest })}\n`);
    else narr.kv("buyer credit", usdc(credit));
    return;
  }

  const yes = flags.has("yes");
  if (cmd === "finalize") {
    const resultName = str("result");
    if (resultName !== "passed" && resultName !== "failed") throw new Error("--result must be passed or failed");
    const evaluator = roleFromEnv(env, "evaluator", "EVALUATOR_PRIVATE_KEY", "EVALUATOR_ADDRESS");
    scrubber.add(evaluator.privateKey);
    let evidence = str("evidence");
    if (evidence === undefined) {
      const api = str("api") ?? optional(env, "LEMMA_API_URL");
      if (api === undefined) throw new Error("--evidence is required when no --api / LEMMA_API_URL is available");
      const receipt = await latestReceiptEvidence(api, resolutionId);
      if (receipt === null) throw new Error("no Adoption Receipt found for this resolution; pass --evidence explicitly");
      evidence = receipt.evidenceDigest;
      log(() => narr.say(`using the buyer's latest Adoption Receipt evidence (receipt outcome: ${receipt.outcome})`));
      if (receipt.outcome !== resultName) log(() => narr.note(`evaluator result "${resultName}" differs from the buyer's receipt outcome "${receipt.outcome}"`));
    }
    const ev = Bytes32.safeParse(evidence.toLowerCase());
    if (!ev.success) throw new Error("--evidence must be a 0x-prefixed 32-byte hex digest");
    const problems = await finalizeProblems(c, registry, evaluator.address, resolutionId);
    if (problems.length > 0) throw new Error(`cannot finalize: ${problems.join("; ")}`);
    if (!yes) {
      const signed = await signOutcome(evaluator, registry, { resolutionId, result: RESULT[resultName as ResultName], evidenceDigest: ev.data });
      if (json) process.stdout.write(`${JSON.stringify({ dryRun: true, outcome: signed.outcome, signature: signed.signature, digest: signed.digest })}\n`);
      else {
        narr.say(`signed Outcome(${resultName}) by evaluator ${evaluator.address}; digest ${signed.digest}`);
        narr.note("dry run: nothing broadcast. Re-run with --yes to submit finalizeOutcome.");
      }
      return;
    }
    const out = await submitOutcome({ c, registry, evaluator, resolutionId, result: resultName, evidenceDigest: ev.data as Hex });
    const after = await readWarranty(c.pub, registry, resolutionId);
    const credit = await readCredit(c.pub, registry, after.buyer);
    if (json) {
      process.stdout.write(`${JSON.stringify({ txHash: out.txHash, result: resultName, status: statusName(after.status), digest: out.digest, buyerCredit: credit.toString() })}\n`);
    } else {
      narr.tx(`finalizeOutcome(${resultName}) signed by evaluator ${evaluator.address}`, out.txHash);
      narr.kv("warranty status", statusName(after.status));
      narr.kv("buyer credit", usdc(credit));
    }
    return;
  }

  if (cmd === "expire") {
    const sender = roleFromEnv(env, "evaluator", "EVALUATOR_PRIVATE_KEY", "EVALUATOR_ADDRESS");
    scrubber.add(sender.privateKey);
    const problems = await expireProblems(c, registry, resolutionId);
    if (problems.length > 0) throw new Error(`cannot expire: ${problems.join("; ")}`);
    if (!yes) {
      log(() => narr.note("dry run: expiry is possible. Re-run with --yes to submit expireResolution."));
      if (json) process.stdout.write(`${JSON.stringify({ dryRun: true, expirable: true })}\n`);
      return;
    }
    const txHash = await submitExpire({ c, registry, sender, resolutionId });
    const after = await readWarranty(c.pub, registry, resolutionId);
    if (json) process.stdout.write(`${JSON.stringify({ txHash, status: statusName(after.status) })}\n`);
    else {
      narr.tx("expireResolution", txHash);
      narr.kv("warranty status", statusName(after.status));
    }
    return;
  }
  throw new Error(`unknown command ${cmd}\n${USAGE}`);
}

main().catch((error: unknown) => {
  const msg = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);
  process.stderr.write(`evaluator: ${scrubber.scrub(msg)}\n`);
  process.exit(1);
});
