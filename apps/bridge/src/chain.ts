import type { SignedResolutionVoucher } from "@lemma/core";
import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex, type LocalAccount } from "viem";
import { arbitrumSepolia } from "viem/chains";

import { errorMessage } from "./errors.js";
import type { ActivationRecord } from "./state.js";

/** Minimal ABI derived from contracts/src/ResolutionWarrantyRegistry.sol. */
export const REGISTRY_ABI = [
  {
    type: "function",
    name: "activateResolution",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "v",
        type: "tuple",
        components: [
          { name: "resolutionId", type: "bytes32" },
          { name: "releaseId", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "paymentHash", type: "bytes32" },
          { name: "payloadDigest", type: "bytes32" },
          { name: "expiresAt", type: "uint64" },
        ],
      },
      { name: "providerSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getWarranty",
    stateMutability: "view",
    inputs: [{ name: "resolutionId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "releaseId", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "claimDeadline", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "paymentHash", type: "bytes32" },
          { name: "payloadDigest", type: "bytes32" },
          { name: "evidenceDigest", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

export interface WarrantyActivator {
  activate(voucher: SignedResolutionVoucher): Promise<ActivationRecord>;
}

const now = () => new Date().toISOString();

export function skippedActivation(reason: string): ActivationRecord {
  return { status: "skipped", txHash: null, blockNumber: null, reason, at: now() };
}

/** Submits registry.activateResolution(voucher, signature) from the buyer wallet and waits for the receipt. */
export class ViemWarrantyActivator implements WarrantyActivator {
  constructor(
    private readonly account: LocalAccount,
    private readonly registry: Address | null,
    private readonly rpcUrl: string | null,
  ) {}

  async activate(signed: SignedResolutionVoucher): Promise<ActivationRecord> {
    if (this.registry === null) return skippedActivation("RESOLUTION_WARRANTY_REGISTRY_ADDRESS is not configured; warranty not activated");
    if (this.rpcUrl === null) return skippedActivation("ARBITRUM_SEPOLIA_RPC_URL is not configured; warranty not activated");
    const transport = http(this.rpcUrl);
    const publicClient = createPublicClient({ chain: arbitrumSepolia, transport });
    const wallet = createWalletClient({ account: this.account, chain: arbitrumSepolia, transport });
    const v = signed.voucher;
    try {
      const existing = await publicClient.readContract({ address: this.registry, abi: REGISTRY_ABI, functionName: "getWarranty", args: [v.resolutionId as Hex] });
      if (existing.status !== 0) {
        return { status: "already-active", txHash: null, blockNumber: null, reason: `warranty status ${existing.status}`, at: now() };
      }
      const hash = await wallet.writeContract({
        address: this.registry,
        abi: REGISTRY_ABI,
        functionName: "activateResolution",
        args: [
          {
            resolutionId: v.resolutionId as Hex,
            releaseId: v.releaseId as Hex,
            buyer: v.buyer as Address,
            amount: BigInt(v.amount),
            paymentHash: v.paymentHash as Hex,
            payloadDigest: v.payloadDigest as Hex,
            expiresAt: BigInt(v.expiresAt),
          },
          signed.signature as Hex,
        ],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") {
        return { status: "failed", txHash: hash, blockNumber: receipt.blockNumber.toString(), reason: "activation transaction reverted", at: now() };
      }
      return { status: "activated", txHash: hash, blockNumber: receipt.blockNumber.toString(), reason: null, at: now() };
    } catch (error) {
      return { status: "failed", txHash: null, blockNumber: null, reason: errorMessage(error).slice(0, 300), at: now() };
    }
  }
}

export type WalletBalances = { usdcAtomic: bigint; wei: bigint };

/** Reads the USDC and ETH balances of `address` on Arbitrum Sepolia, bounded by `timeoutMs`. */
export async function readBalances(rpcUrl: string, usdc: Address, address: Address, timeoutMs = 4_000): Promise<WalletBalances> {
  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl, { timeout: timeoutMs, retryCount: 0 }) });
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`RPC did not answer within ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    const [usdcAtomic, wei] = await Promise.race([
      Promise.all([client.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] }), client.getBalance({ address })]),
      deadline,
    ]);
    return { usdcAtomic, wei };
  } finally {
    clearTimeout(timer);
  }
}
