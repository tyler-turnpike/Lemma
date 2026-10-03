import { createPaymentWrapper, type AfterSettlementHook, type MCPToolCallback, type PaymentWrappedHandler } from "@x402/mcp";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import type { PaymentPolicy } from "./facilitator.js";

/** EIP-712 domain of Arbitrum Sepolia USDC (FiatTokenV2_2), required for EIP-3009 signing. */
export const USDC_EIP712 = { name: "USD Coin", version: "2" } as const;
export const PURCHASE_TOOL = "lemma_purchase_resolution";
export const SUCCESS_FEE_TOOL = "lemma_pay_success_fee";
export type PaidTool = typeof PURCHASE_TOOL | typeof SUCCESS_FEE_TOOL;
/** Bound on cached payment wrappers; quotes sit on a 500-atomic grid under a 0.25 USDC cap. */
const MAX_WRAPPERS = 1024;

const RESOURCES: Record<PaidTool, string> = {
  [PURCHASE_TOOL]: "Lemma Compatibility Resolution with provider warranty voucher",
  [SUCCESS_FEE_TOOL]: "Lemma success fee, owed after the acceptance tests passed",
};
/** How long a signed EIP-3009 authorization may wait before settlement. */
export const PAYMENT_MAX_TIMEOUT_SECONDS = 300;

type PaidArgs = Record<string, unknown>;
type Wrap = <A extends PaidArgs>(handler: PaymentWrappedHandler<A>) => MCPToolCallback<A>;

/**
 * Owns the x402 resource server and one payment wrapper per (tool, atomic price). The price is
 * expressed as an explicit AssetAmount (atomic USDC + asset + EIP-712 domain) so it never
 * passes through a floating-point "$" conversion.
 */
export class PaymentGateway {
  private readonly server: x402ResourceServer;
  private initialized: Promise<void> | undefined;
  private readonly wrappers = new Map<string, Promise<{ wrap: Wrap; accepts: PaymentRequirements[] }>>();

  constructor(
    facilitatorClient: FacilitatorClient,
    private readonly policy: PaymentPolicy,
    private readonly onAfterSettlement: AfterSettlementHook,
    private readonly onSuccessFeeSettlement: AfterSettlementHook = onAfterSettlement,
  ) {
    this.server = new x402ResourceServer(facilitatorClient).register(policy.network, new ExactEvmScheme());
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized === undefined) {
      this.initialized = this.server.initialize().catch((error: unknown) => {
        this.initialized = undefined; // retry on the next call
        throw error;
      });
    }
    return this.initialized;
  }

  /** Payment requirements for an atomic USDC price. */
  async requirementsFor(priceAtomic: string, tool: PaidTool = PURCHASE_TOOL): Promise<PaymentRequirements[]> {
    return (await this.entry(priceAtomic, tool)).accepts;
  }

  /** The x402 payment wrapper bound to an atomic USDC price for one paid tool (cached). */
  async wrapperFor(priceAtomic: string, tool: PaidTool = PURCHASE_TOOL): Promise<Wrap> {
    return (await this.entry(priceAtomic, tool)).wrap;
  }

  private entry(priceAtomic: string, tool: PaidTool) {
    if (!/^[1-9][0-9]{0,30}$/.test(priceAtomic)) return Promise.reject(new Error("invalid price"));
    const key = `${tool}|${priceAtomic}`;
    let cached = this.wrappers.get(key);
    if (cached === undefined) {
      if (this.wrappers.size >= MAX_WRAPPERS) this.wrappers.delete(this.wrappers.keys().next().value!);
      cached = (async () => {
        await this.ensureInitialized();
        const accepts = await this.server.buildPaymentRequirements({
          scheme: "exact",
          network: this.policy.network,
          payTo: this.policy.payTo,
          price: { amount: priceAtomic, asset: this.policy.asset, extra: { ...USDC_EIP712 } },
          maxTimeoutSeconds: PAYMENT_MAX_TIMEOUT_SECONDS,
        });
        const paid = createPaymentWrapper(this.server, {
          accepts,
          resource: { url: `mcp://tool/${tool}`, description: RESOURCES[tool], mimeType: "application/json" },
          hooks: { onAfterSettlement: tool === PURCHASE_TOOL ? this.onAfterSettlement : this.onSuccessFeeSettlement },
        });
        return { wrap: paid as Wrap, accepts };
      })();
      cached.catch(() => this.wrappers.delete(key));
      this.wrappers.set(key, cached);
    }
    return cached;
  }
}
