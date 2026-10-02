import { createPaymentWrapper, type AfterSettlementHook, type MCPToolCallback, type PaymentWrappedHandler } from "@x402/mcp";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";

import type { PaymentPolicy } from "./facilitator.js";

/** EIP-712 domain of Arbitrum Sepolia USDC (FiatTokenV2_2), required for EIP-3009 signing. */
export const USDC_EIP712 = { name: "USD Coin", version: "2" } as const;
export const PURCHASE_TOOL = "lemma_purchase_resolution";
/** How long a signed EIP-3009 authorization may wait before settlement. */
export const PAYMENT_MAX_TIMEOUT_SECONDS = 300;

type PurchaseArgs = { previewId: string; buyer: string };
type Wrap = (handler: PaymentWrappedHandler<PurchaseArgs>) => MCPToolCallback<PurchaseArgs>;

/**
 * Owns the x402 resource server and one payment wrapper per atomic price. The price is
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
  async requirementsFor(priceAtomic: string): Promise<PaymentRequirements[]> {
    return (await this.entry(priceAtomic)).accepts;
  }

  /** The x402 payment wrapper bound to an atomic USDC price (cached per price). */
  async wrapperFor(priceAtomic: string): Promise<Wrap> {
    return (await this.entry(priceAtomic)).wrap;
  }

  private entry(priceAtomic: string) {
    if (!/^[1-9][0-9]{0,30}$/.test(priceAtomic)) return Promise.reject(new Error("invalid price"));
    let cached = this.wrappers.get(priceAtomic);
    if (cached === undefined) {
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
          resource: {
            url: `mcp://tool/${PURCHASE_TOOL}`,
            description: "Lemma Compatibility Resolution with provider warranty voucher",
            mimeType: "application/json",
          },
          hooks: { onAfterSettlement: this.onAfterSettlement },
        });
        return { wrap: paid as Wrap, accepts };
      })();
      cached.catch(() => this.wrappers.delete(priceAtomic));
      this.wrappers.set(priceAtomic, cached);
    }
    return cached;
  }
}
