import { evaluateSpend } from "@lemma/core";
import type { PaymentRequirements } from "@x402/core/types";

import type { SpendLedger } from "./ledger.js";

export const PURCHASE_TOOL = "lemma_purchase_resolution";
export const SUCCESS_FEE_TOOL = "lemma_pay_success_fee";
const MAX_PAYMENT_TIMEOUT_SECONDS = 3_600;

/** What the bridge expects to pay, derived only from the stored preview and local config. */
export type PaymentExpectation = {
  previewId: string;
  buyer: string;
  priceAtomic: bigint;
  network: string;
  usdcAddress: string;
  payTo: string;
  perResolutionCapAtomic: bigint;
  dailyCapAtomic: bigint;
  /** Paid tool allowed to request this payment (default: the purchase tool). */
  tool?: string;
  /** Exact arguments the paid call must carry (default: { previewId, buyer }). */
  args?: Readonly<Record<string, string>>;
  /** Ledger entry this spend is recorded under (default: previewId). */
  ledgerKey?: string;
};

/** Local policy check run before connecting (preview price against caps and budget). */
export function precheckSpend(exp: PaymentExpectation, spentTodayAtomic: bigint, now: Date): string[] {
  return evaluateSpend({
    priceAtomic: exp.priceAtomic,
    perResolutionCapAtomic: exp.perResolutionCapAtomic,
    dailyCapAtomic: exp.dailyCapAtomic,
    spentTodayAtomic,
    network: exp.network,
    allowedNetworks: [exp.network],
    token: exp.usdcAddress,
    expectedToken: exp.usdcAddress,
    recipient: exp.payTo,
    expectedRecipient: exp.payTo,
    expiresAt: new Date(now.getTime() + 60_000),
    now,
  }).reasons;
}

/** Validates one x402 payment requirement against the expectation. Empty array = acceptable. */
export function checkRequirement(req: PaymentRequirements, exp: PaymentExpectation, spentTodayAtomic: bigint, now: Date): string[] {
  const reasons: string[] = [];
  if (req.scheme !== "exact") reasons.push("scheme must be exact");
  let amount: bigint | null = null;
  if (typeof req.amount === "string" && /^(0|[1-9][0-9]{0,30})$/.test(req.amount)) amount = BigInt(req.amount);
  else reasons.push("amount must be an atomic integer string");
  if (amount !== null && amount !== exp.priceAtomic) reasons.push("amount does not equal the previewed price");
  const method = (req.extra as Record<string, unknown> | undefined)?.["assetTransferMethod"];
  if (method !== undefined && method !== "eip3009") reasons.push("only EIP-3009 transfer authorizations are allowed");
  const timeout = req.maxTimeoutSeconds;
  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > MAX_PAYMENT_TIMEOUT_SECONDS) reasons.push("payment timeout is out of range");
  const decision = evaluateSpend({
    priceAtomic: amount ?? 0n,
    perResolutionCapAtomic: exp.perResolutionCapAtomic,
    dailyCapAtomic: exp.dailyCapAtomic,
    spentTodayAtomic,
    network: req.network,
    allowedNetworks: [exp.network],
    token: req.asset,
    expectedToken: exp.usdcAddress,
    recipient: req.payTo,
    expectedRecipient: exp.payTo,
    expiresAt: new Date(now.getTime() + (Number.isInteger(timeout) && timeout > 0 ? timeout * 1000 : 0)),
    now,
  });
  for (const r of decision.reasons) if (!reasons.includes(r)) reasons.push(r);
  return reasons;
}

function sameRequirement(a: PaymentRequirements, b: PaymentRequirements): boolean {
  return (
    a.scheme === b.scheme &&
    a.network === b.network &&
    a.asset.toLowerCase() === b.asset.toLowerCase() &&
    a.payTo.toLowerCase() === b.payTo.toLowerCase() &&
    a.amount === b.amount
  );
}

type RequestedContext = { toolName: string; arguments: Record<string, unknown>; paymentRequired: { accepts: PaymentRequirements[] } };

/**
 * The single gate between a server's payment request and the buyer key. It is wired into
 * the x402 client three times: as the onPaymentRequested approval hook, as a payment policy
 * that filters requirements, and as a before-creation hook on the exact requirement that is
 * about to be signed. It approves at most one payment per instance and records the spend in
 * the persistent ledger before approving, so a deviating or repeated request is refused.
 */
export class PaymentGuard {
  approved: PaymentRequirements | null = null;
  refusals: string[] = [];
  private approvals = 0;

  constructor(
    readonly expectation: PaymentExpectation,
    private readonly ledger: SpendLedger,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  get paymentAuthorized(): boolean {
    return this.approvals > 0;
  }

  /** onPaymentRequested hook for x402MCPClient. */
  readonly onPaymentRequested = async (ctx: RequestedContext): Promise<boolean> => {
    const refuse = (reasons: string[]) => {
      this.refusals = reasons;
      return false;
    };
    const exp = this.expectation;
    if (ctx.toolName !== (exp.tool ?? PURCHASE_TOOL)) return refuse([`payment requested by unexpected tool ${ctx.toolName}`]);
    if (this.approvals > 0) return refuse(["a payment was already authorized for this purchase; refusing to pay again"]);
    const expectedArgs = exp.args ?? { previewId: exp.previewId, buyer: exp.buyer };
    if (Object.entries(expectedArgs).some(([k, v]) => ctx.arguments[k] !== v)) {
      return refuse(["payment request does not match the purchase being made"]);
    }
    const ledgerKey = exp.ledgerKey ?? exp.previewId;
    const now = this.clock();
    if ((await this.ledger.get(ledgerKey)) !== null) {
      return refuse(["a spend for this preview is already recorded; recovery must be used instead of paying"]);
    }
    const spent = await this.ledger.spentOn(now);
    const accepts = Array.isArray(ctx.paymentRequired.accepts) ? ctx.paymentRequired.accepts : [];
    const problems: string[] = [];
    for (const req of accepts) {
      const reasons = checkRequirement(req, this.expectation, spent, now);
      if (reasons.length === 0) {
        // Persist the spend before any signature exists.
        const { created } = await this.ledger.authorize(ledgerKey, exp.priceAtomic, now);
        if (!created) return refuse(["a spend for this preview is already recorded; refusing to pay again"]);
        this.approved = req;
        this.approvals += 1;
        return true;
      }
      problems.push(...reasons);
    }
    return refuse(problems.length > 0 ? [...new Set(problems)] : ["no payment requirements offered"]);
  };

  /** x402 PaymentPolicy: only the approved requirement may be selected. */
  readonly policy = (_version: number, reqs: PaymentRequirements[]): PaymentRequirements[] => {
    const approved = this.approved;
    return approved === null ? [] : reqs.filter((r) => sameRequirement(r, approved));
  };

  /** x402Client before-payment-creation hook: last check on the exact requirement being signed. */
  readonly beforePaymentCreation = async (ctx: { selectedRequirements: PaymentRequirements }): Promise<void | { abort: true; reason: string }> => {
    const approved = this.approved;
    if (approved === null || !sameRequirement(ctx.selectedRequirements, approved)) {
      return { abort: true, reason: "requirement was not approved by the local spend policy" };
    }
    return undefined;
  };
}
