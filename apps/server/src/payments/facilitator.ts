import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from "@x402/core/types";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme as ExactEvmFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

/** The only payment shape this deployment will verify or settle. */
export type PaymentPolicy = {
  network: `eip155:${number}`;
  asset: Address;
  payTo: Address;
};

/** Returns a reason string when requirements fall outside the policy, else null. */
export function policyViolation(policy: PaymentPolicy, requirements: PaymentRequirements): string | null {
  if (requirements.scheme !== "exact") return "unsupported scheme";
  if (requirements.network !== policy.network) return "unsupported network";
  if (requirements.asset.toLowerCase() !== policy.asset.toLowerCase()) return "unsupported asset";
  if (requirements.payTo.toLowerCase() !== policy.payTo.toLowerCase()) return "unsupported payTo";
  if (!/^[1-9][0-9]{0,30}$/.test(requirements.amount)) return "invalid amount";
  return null;
}

/**
 * Self-hosted x402 facilitator for Arbitrum Sepolia using the `exact` EVM scheme
 * (EIP-3009 transferWithAuthorization). Restricted by `policy` so the facilitator key
 * only ever pays gas for USDC payments to the provider.
 */
export function createLocalFacilitator(options: {
  privateKey: Hex;
  rpcUrl: string;
  policy: PaymentPolicy;
  confirmationTimeoutMs?: number;
}): { facilitator: x402Facilitator; address: Address } {
  const account = privateKeyToAccount(options.privateKey);
  const transport = http(options.rpcUrl, { timeout: 20_000, retryCount: 2 });
  const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
  const walletClient = createWalletClient({ account, chain: arbitrumSepolia, transport });

  const signer = toFacilitatorEvmSigner(
    {
      address: account.address,
      readContract: (args) =>
        publicClient.readContract({ address: args.address, abi: args.abi as never, functionName: args.functionName as never, args: (args.args ?? []) as never }),
      verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
      writeContract: (args) =>
        walletClient.writeContract({
          address: args.address,
          abi: args.abi as never,
          functionName: args.functionName as never,
          args: args.args as never,
          ...(args.gas === undefined ? {} : { gas: args.gas }),
          ...(args.dataSuffix === undefined ? {} : { dataSuffix: args.dataSuffix }),
        } as never),
      sendTransaction: (args) => walletClient.sendTransaction({ to: args.to, data: args.data } as never),
      waitForTransactionReceipt: (args) =>
        publicClient.waitForTransactionReceipt({ hash: args.hash, ...(args.timeout === undefined ? {} : { timeout: args.timeout }) }),
      getCode: (args) => publicClient.getCode({ address: args.address }),
    },
    { confirmationTimeoutMs: options.confirmationTimeoutMs ?? 30_000 },
  );

  const facilitator = new x402Facilitator().register(options.policy.network, new ExactEvmFacilitatorScheme(signer));
  facilitator.onBeforeVerify(async ({ requirements }) => {
    const reason = policyViolation(options.policy, requirements);
    return reason === null ? undefined : { abort: true as const, reason };
  });
  facilitator.onBeforeSettle(async ({ requirements }) => {
    const reason = policyViolation(options.policy, requirements);
    return reason === null ? undefined : { abort: true as const, reason };
  });
  return { facilitator, address: account.address };
}

/** In-process FacilitatorClient so the resource server does not need an HTTP hop to itself. */
export function inProcessFacilitatorClient(facilitator: x402Facilitator): FacilitatorClient {
  return {
    verify: (payload: PaymentPayload, req: PaymentRequirements): Promise<VerifyResponse> => facilitator.verify(payload, req),
    settle: (payload: PaymentPayload, req: PaymentRequirements): Promise<SettleResponse> => facilitator.settle(payload, req),
    getSupported: async (): Promise<SupportedResponse> => facilitator.getSupported() as SupportedResponse,
  };
}
