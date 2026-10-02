/** Evaluator operations: sign an EIP-712 Outcome with the core typed data and finalize or expire. */
import { lemmaDomain, outcomeTypedData, outcomeTypedDataHash, OutcomeMessage, type OutcomeMessage as OutcomeMessageT } from "@lemma/core";
import { getAddress, type Address, type Hex } from "viem";

import { CHAIN_ID, REGISTRY_ABI, mined, readRelease, readWarranty, statusName, type Clients } from "./chain.js";
import type { Role } from "./env.js";

export const RESULT = { passed: 1, failed: 2 } as const;
export type ResultName = keyof typeof RESULT;

export type SignedOutcome = { outcome: OutcomeMessageT; signature: Hex; digest: Hex };

export async function signOutcome(evaluator: Role, registry: Address, outcomeInput: OutcomeMessageT): Promise<SignedOutcome> {
  const outcome = OutcomeMessage.parse(outcomeInput);
  const domain = lemmaDomain(registry, CHAIN_ID);
  const signature = await evaluator.account.signTypedData(outcomeTypedData(domain, outcome));
  return { outcome, signature, digest: outcomeTypedDataHash(domain, outcome) };
}

/** Checks the warranty can be finalized by this evaluator right now. Returns problems, empty when fine. */
export async function finalizeProblems(c: Clients, registry: Address, evaluator: Address, resolutionId: Hex): Promise<string[]> {
  const w = await readWarranty(c.pub, registry, resolutionId);
  const problems: string[] = [];
  if (w.status !== 1) problems.push(`warranty status is ${statusName(w.status)}, not Active`);
  else {
    const block = await c.pub.getBlock();
    if (block.timestamp > w.claimDeadline) problems.push(`claim window closed at ${new Date(Number(w.claimDeadline) * 1000).toISOString()}; use expire`);
    const r = await readRelease(c.pub, registry, w.releaseId);
    if (getAddress(r.evaluator) !== getAddress(evaluator)) problems.push(`release evaluator is ${r.evaluator}, not ${evaluator}`);
  }
  return problems;
}

export async function submitOutcome(opts: {
  c: Clients;
  registry: Address;
  evaluator: Role;
  /** Who pays gas; anyone may submit. Defaults to the evaluator. */
  submitter?: Role;
  resolutionId: Hex;
  result: ResultName;
  evidenceDigest: Hex;
}): Promise<SignedOutcome & { txHash: Hex }> {
  const { c, registry, evaluator } = opts;
  const problems = await finalizeProblems(c, registry, evaluator.address, opts.resolutionId);
  if (problems.length > 0) throw new Error(`cannot finalize: ${problems.join("; ")}`);
  const signed = await signOutcome(evaluator, registry, { resolutionId: opts.resolutionId, result: RESULT[opts.result], evidenceDigest: opts.evidenceDigest });
  const message = { resolutionId: signed.outcome.resolutionId as Hex, result: signed.outcome.result, evidenceDigest: signed.outcome.evidenceDigest as Hex };
  const onchain = await c.pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "hashOutcome", args: [message] });
  if (onchain !== signed.digest) throw new Error("registry hashOutcome does not match the core EIP-712 digest; refusing to submit");
  const sender = opts.submitter ?? evaluator;
  const txHash = await c.wallet(sender.account).writeContract({ address: registry, abi: REGISTRY_ABI, functionName: "finalizeOutcome", args: [message, signed.signature] });
  await mined(c.pub, txHash);
  return { ...signed, txHash };
}

export async function expireProblems(c: Clients, registry: Address, resolutionId: Hex): Promise<string[]> {
  const w = await readWarranty(c.pub, registry, resolutionId);
  if (w.status !== 1) return [`warranty status is ${statusName(w.status)}, not Active`];
  const block = await c.pub.getBlock();
  if (block.timestamp <= w.claimDeadline) return [`claim window is open until ${new Date(Number(w.claimDeadline) * 1000).toISOString()}`];
  return [];
}

export async function submitExpire(opts: { c: Clients; registry: Address; sender: Role; resolutionId: Hex }): Promise<Hex> {
  const problems = await expireProblems(opts.c, opts.registry, opts.resolutionId);
  if (problems.length > 0) throw new Error(`cannot expire: ${problems.join("; ")}`);
  const txHash = await opts.c.wallet(opts.sender.account).writeContract({ address: opts.registry, abi: REGISTRY_ABI, functionName: "expireResolution", args: [opts.resolutionId] });
  await mined(opts.c.pub, txHash);
  return txHash;
}
