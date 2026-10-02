import { PRICE_TO_SAVING_MAX_PERCENT } from "./constants.js";

export type SpendRequest = {
  priceAtomic: bigint;
  perResolutionCapAtomic: bigint;
  dailyCapAtomic: bigint;
  spentTodayAtomic: bigint;
  /** Network named in the payment requirement (e.g. "arbitrum-sepolia" or "eip155:421614"). */
  network: string;
  /** Networks the bridge is configured to pay on. Defaults to Arbitrum Sepolia. */
  allowedNetworks?: readonly string[];
  token: string;
  expectedToken: string;
  recipient: string;
  expectedRecipient: string;
  /** Quote/requirement expiry. */
  expiresAt: Date;
  now: Date;
};

export type SpendDecision = { allowed: boolean; reasons: string[] };

const DEFAULT_ALLOWED_NETWORKS = ["arbitrum-sepolia", "eip155:421614"] as const;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Pure, fail-closed spend policy. Every check runs so the caller sees all reasons.
 * Any malformed input denies the spend.
 */
export function evaluateSpend(req: SpendRequest): SpendDecision {
  const reasons: string[] = [];
  const isBig = (v: unknown): v is bigint => typeof v === "bigint";

  if (![req.priceAtomic, req.perResolutionCapAtomic, req.dailyCapAtomic, req.spentTodayAtomic].every(isBig)) {
    return { allowed: false, reasons: ["amounts must be bigint atomic units"] };
  }
  if (req.priceAtomic <= 0n) reasons.push("price must be positive");
  if (req.perResolutionCapAtomic < 0n || req.dailyCapAtomic < 0n || req.spentTodayAtomic < 0n) {
    reasons.push("caps and spend must be non-negative");
  }
  if (req.priceAtomic > req.perResolutionCapAtomic) reasons.push("price exceeds per-resolution cap");
  if (req.spentTodayAtomic + req.priceAtomic > req.dailyCapAtomic) reasons.push("price exceeds remaining daily cap");

  const allowedNetworks = req.allowedNetworks ?? DEFAULT_ALLOWED_NETWORKS;
  if (typeof req.network !== "string" || !allowedNetworks.includes(req.network)) reasons.push("network is not allowed");

  if (!sameAddress(req.token, req.expectedToken)) reasons.push("token does not match expected token");
  if (!sameAddress(req.recipient, req.expectedRecipient)) reasons.push("recipient does not match expected recipient");

  const exp = req.expiresAt instanceof Date ? req.expiresAt.getTime() : Number.NaN;
  const now = req.now instanceof Date ? req.now.getTime() : Number.NaN;
  if (!Number.isFinite(exp) || !Number.isFinite(now)) reasons.push("invalid expiry or clock");
  else if (exp <= now) reasons.push("quote has expired");

  return { allowed: reasons.length === 0, reasons };
}

function sameAddress(a: unknown, b: unknown): boolean {
  return typeof a === "string" && typeof b === "string" && ADDRESS_RE.test(a) && ADDRESS_RE.test(b) && a.toLowerCase() === b.toLowerCase();
}

/** Pricing rule: price <= 30% of expected saving, integer math. False when saving is unknown. */
export function isPriceJustified(priceAtomic: bigint, expectedSavingAtomic: bigint | null): boolean {
  if (expectedSavingAtomic === null || typeof expectedSavingAtomic !== "bigint" || typeof priceAtomic !== "bigint") return false;
  if (priceAtomic < 0n || expectedSavingAtomic <= 0n) return false;
  return priceAtomic * 100n <= expectedSavingAtomic * PRICE_TO_SAVING_MAX_PERCENT;
}
