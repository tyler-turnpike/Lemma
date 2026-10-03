// Added by Lemma capability release x402-mcp-client@1.1.0.
// Adapted from the x402 MCP client integration (x402-foundation/x402, Apache-2.0).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { x402Client } from "@x402/core/client";
import type { Network, PaymentRequirements } from "@x402/core/types";
import type { ClientEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { x402MCPClient } from "@x402/mcp";

/** Arbitrum Sepolia (CAIP-2) and its Circle test USDC (6 decimals). */
export const ARBITRUM_SEPOLIA: Network = "eip155:421614";
export const ARBITRUM_SEPOLIA_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

export type SpendLimits = {
  /** Hard cap per paid tool call, USDC atomic units (6 decimals). */
  maxPerCallAtomic: bigint;
  /** Hard cap across the lifetime of this client (e.g. a daily budget), USDC atomic units. */
  maxTotalAtomic: bigint;
  /** Only these recipients may be paid. */
  allowedPayTo: readonly string[];
};

export type PaymentRecord = { toolName: string; amountAtomic: bigint; payTo: string; transaction: string | null };

export type PayingMcpClientOptions = {
  signer: ClientEvmSigner;
  limits: SpendLimits;
  name?: string;
  version?: string;
  /** Optional extra approval step (e.g. human in the loop). Returning false aborts the payment. */
  approve?: (toolName: string, amountAtomic: bigint) => boolean | Promise<boolean>;
  onPayment?: (record: PaymentRecord) => void;
};

export class SpendLimitError extends Error {
  override name = "SpendLimitError";
}

/**
 * Tracks committed spend. A reservation is taken synchronously before a payment is signed,
 * so concurrent calls cannot overshoot the budget. Once signed, the amount stays committed
 * (a signed authorization can be settled even if the response is lost).
 */
export class SpendLedger {
  private committed = 0n;
  constructor(private readonly limits: SpendLimits) {
    if (limits.maxPerCallAtomic <= 0n || limits.maxTotalAtomic <= 0n) throw new SpendLimitError("spend limits must be positive");
    if (limits.allowedPayTo.length === 0) throw new SpendLimitError("at least one allowed recipient is required");
  }
  get spentAtomic(): bigint {
    return this.committed;
  }
  get remainingAtomic(): bigint {
    return this.limits.maxTotalAtomic - this.committed;
  }
  /** Returns a reason when the requirement violates the limits, otherwise null. */
  check(req: PaymentRequirements): string | null {
    if (req.network !== ARBITRUM_SEPOLIA) return `network ${req.network} is not allowed`;
    if (req.asset.toLowerCase() !== ARBITRUM_SEPOLIA_USDC.toLowerCase()) return `asset ${req.asset} is not allowed`;
    if (!this.limits.allowedPayTo.some((a) => a.toLowerCase() === req.payTo.toLowerCase())) return `recipient ${req.payTo} is not allowed`;
    if (!/^[1-9][0-9]{0,30}$/.test(req.amount)) return `amount ${req.amount} is not a positive integer`;
    const amount = BigInt(req.amount);
    if (amount > this.limits.maxPerCallAtomic) return `amount ${req.amount} exceeds the per-call cap`;
    if (amount > this.remainingAtomic) return `amount ${req.amount} exceeds the remaining budget`;
    return null;
  }
  reserve(req: PaymentRequirements): string | null {
    const problem = this.check(req);
    if (problem === null) this.committed += BigInt(req.amount);
    return problem;
  }
  release(req: PaymentRequirements): void {
    if (/^[1-9][0-9]{0,30}$/.test(req.amount)) this.committed -= BigInt(req.amount);
  }
}

/** Creates an MCP client that pays x402-protected tools within hard, code-enforced limits. */
export function createPayingMcpClient(options: PayingMcpClientOptions): { client: x402MCPClient; ledger: SpendLedger } {
  const ledger = new SpendLedger(options.limits);
  const payments = new x402Client()
    .register(ARBITRUM_SEPOLIA, new ExactEvmScheme(options.signer))
    .registerPolicy((_version, reqs) => reqs.filter((r) => ledger.check(r) === null))
    .onBeforePaymentCreation(async ({ selectedRequirements }) => {
      const problem = ledger.reserve(selectedRequirements);
      return problem === null ? undefined : { abort: true as const, reason: problem };
    })
    .onPaymentCreationFailure(async ({ selectedRequirements }) => {
      ledger.release(selectedRequirements);
    });

  const mcp = new Client({ name: options.name ?? "x402-paying-agent", version: options.version ?? "1.0.0" });
  const client = new x402MCPClient(mcp, payments, {
    autoPayment: true,
    onPaymentRequested: async ({ toolName, paymentRequired }) => {
      const affordable = paymentRequired.accepts.filter((r) => ledger.check(r) === null);
      const first = affordable[0];
      if (first === undefined) return false;
      return options.approve === undefined ? true : await options.approve(toolName, BigInt(first.amount));
    },
  });
  client.onAfterPayment(({ toolName, paymentPayload, settleResponse }) => {
    options.onPayment?.({
      toolName,
      amountAtomic: BigInt(paymentPayload.accepted.amount),
      payTo: paymentPayload.accepted.payTo,
      transaction: settleResponse?.transaction ?? null,
    });
  });
  return { client, ledger };
}
