// Added by Lemma capability release x402-mcp-server@1.1.0.
// Adapted from the x402 MCP server integration (x402-foundation/x402, Apache-2.0).
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPaymentWrapper, type MCPToolCallback, type PaymentWrappedHandler } from "@x402/mcp";

/** Arbitrum Sepolia (CAIP-2) and its Circle test USDC (6 decimals, EIP-3009). */
export const ARBITRUM_SEPOLIA: Network = "eip155:421614";
export const ARBITRUM_SEPOLIA_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

export type X402PaywallOptions = {
  /** Facilitator that verifies and settles payments (HTTP facilitator in production). */
  facilitator: FacilitatorClient;
  /** Recipient of tool payments. */
  payTo: `0x${string}`;
  /** Price per paid call in USDC atomic units (6 decimals), e.g. "10000" = 0.01 USDC. */
  priceAtomic: string;
  /** Seconds the client has to complete payment. Defaults to 300. */
  maxTimeoutSeconds?: number;
  description?: string;
};

export type X402Paywall = {
  /** Wraps an MCP tool handler so it only runs after a verified x402 payment. */
  paid<TArgs extends Record<string, unknown>>(handler: PaymentWrappedHandler<TArgs>): MCPToolCallback<TArgs>;
  /** Resolves the payment requirements advertised to clients (initializes lazily). */
  requirements(): Promise<PaymentRequirements[]>;
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ATOMIC_RE = /^[1-9][0-9]{0,30}$/;

export function createX402Paywall(options: X402PaywallOptions): X402Paywall {
  if (!ADDRESS_RE.test(options.payTo)) throw new Error("x402 paywall: payTo must be a 20-byte hex address");
  if (!ATOMIC_RE.test(options.priceAtomic)) throw new Error("x402 paywall: priceAtomic must be a positive integer string");

  const resourceServer = new x402ResourceServer(options.facilitator);
  resourceServer.register(ARBITRUM_SEPOLIA, new ExactEvmScheme());

  let accepts: Promise<PaymentRequirements[]> | undefined;
  const requirements = () => {
    accepts ??= (async () => {
      await resourceServer.initialize();
      return resourceServer.buildPaymentRequirements({
        scheme: "exact",
        network: ARBITRUM_SEPOLIA,
        payTo: options.payTo,
        price: { asset: ARBITRUM_SEPOLIA_USDC, amount: options.priceAtomic, extra: { name: "USD Coin", version: "2" } },
        maxTimeoutSeconds: options.maxTimeoutSeconds ?? 300,
      });
    })().catch((error: unknown) => {
      accepts = undefined; // allow a later retry if the facilitator was unreachable
      throw error;
    });
    return accepts;
  };

  return {
    requirements,
    paid<TArgs extends Record<string, unknown>>(handler: PaymentWrappedHandler<TArgs>): MCPToolCallback<TArgs> {
      let wrapped: MCPToolCallback<TArgs> | undefined;
      return async (args, extra) => {
        if (wrapped === undefined) {
          const resolved = await requirements();
          const resource = options.description === undefined ? undefined : { description: options.description };
          wrapped = createPaymentWrapper(resourceServer, resource === undefined ? { accepts: resolved } : { accepts: resolved, resource })(handler);
        }
        return wrapped(args, extra);
      };
    },
  };
}

/**
 * Production configuration from the environment:
 * X402_FACILITATOR_URL, X402_PAY_TO, X402_PRICE_ATOMIC (default "10000" = 0.01 USDC).
 */
export function createX402PaywallFromEnv(env: NodeJS.ProcessEnv = process.env): X402Paywall {
  const url = env["X402_FACILITATOR_URL"];
  const payTo = env["X402_PAY_TO"];
  if (url === undefined || !/^https?:\/\//.test(url)) throw new Error("X402_FACILITATOR_URL must be set to an http(s) URL");
  if (payTo === undefined || !ADDRESS_RE.test(payTo)) throw new Error("X402_PAY_TO must be set to a 20-byte hex address");
  return createX402Paywall({
    facilitator: new HTTPFacilitatorClient({ url }),
    payTo: payTo as `0x${string}`,
    priceAtomic: env["X402_PRICE_ATOMIC"] ?? "10000",
  });
}
