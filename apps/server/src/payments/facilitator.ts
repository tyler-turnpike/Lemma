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
 * `eth_getCode` for the facilitator signer that retries and never rejects (resolves `undefined`
 * after the last failure).
 *
 * Why: `@x402/evm` 2.27.0 starts its asset-contract check (`AssetContractCheck`) eagerly when
 * verification begins and does not await it when verification returns early (for example when
 * the buyer's balance read failed). A rejected getCode then becomes an unhandled rejection,
 * which terminates the Node process. Against a real RPC (timeouts, TLS/proxy errors) that
 * killed the server in the middle of a paid call. Resolving `undefined` makes the check report
 * "asset not deployed", so verification fails closed and the buyer is told before settlement.
 */
export function resilientGetCode(
  client: { getCode(args: { address: Address }): Promise<Hex | undefined> },
  options: { attempts?: number; delayMs?: number; onError?: (message: string) => void } = {},
): (args: { address: Address }) => Promise<Hex | undefined> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 500;
  return async (args) => {
    let last = "";
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, delayMs * i));
      try {
        return await client.getCode({ address: args.address });
      } catch (error) {
        last = error instanceof Error ? ((error as { shortMessage?: string }).shortMessage ?? error.message) : String(error);
      }
    }
    options.onError?.(`eth_getCode ${args.address} failed after ${attempts} attempts: ${last}`);
    return undefined;
  };
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
  /** Receives RPC failures that are deliberately not thrown (see resilientGetCode). */
  onRpcError?: (message: string) => void;
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
      getCode: resilientGetCode(publicClient, options.onRpcError === undefined ? {} : { onError: options.onRpcError }),
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
