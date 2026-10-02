/** Chain helpers shared by the operator scripts (viem, Arbitrum Sepolia or an Anvil fork of it). */
import { ARBITRUM_SEPOLIA, formatUsdc } from "@lemma/core";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
  type Chain,
  type Transport,
  type Account,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";

export const USDC: Address = ARBITRUM_SEPOLIA.usdc as Address;
export const CHAIN_ID = ARBITRUM_SEPOLIA.chainId;

export const REGISTRY_ABI = parseAbi([
  "function registerRelease(bytes32 releaseId, address provider, address evaluator, uint256 price, uint64 claimWindow)",
  "function depositBond(bytes32 releaseId, uint256 amount)",
  "function withdrawUnreservedBond(bytes32 releaseId, uint256 amount)",
  "function activateResolution((bytes32 resolutionId, bytes32 releaseId, address buyer, uint256 amount, bytes32 paymentHash, bytes32 payloadDigest, uint64 expiresAt) v, bytes providerSig)",
  "function finalizeOutcome((bytes32 resolutionId, uint8 result, bytes32 evidenceDigest) o, bytes evaluatorSig)",
  "function expireResolution(bytes32 resolutionId)",
  "function withdrawCredit()",
  "function getRelease(bytes32 releaseId) view returns ((address provider, address evaluator, uint256 price, uint64 claimWindow, bool registered, bool active, uint256 availableBond, uint256 reservedBond))",
  "function getWarranty(bytes32 resolutionId) view returns ((bytes32 releaseId, address buyer, uint256 amount, uint64 claimDeadline, uint8 status, bytes32 paymentHash, bytes32 payloadDigest, bytes32 evidenceDigest))",
  "function hashOutcome((bytes32 resolutionId, uint8 result, bytes32 evidenceDigest) o) view returns (bytes32)",
  "function credits(address) view returns (uint256)",
  "function usdc() view returns (address)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function paused() view returns (bool)",
  "function totalAvailableBond() view returns (uint256)",
  "function totalReservedBond() view returns (uint256)",
  "function totalCredits() view returns (uint256)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const WARRANTY_STATUS = ["None", "Active", "Passed", "Failed", "Expired"] as const;
export const statusName = (s: number) => WARRANTY_STATUS[s] ?? `unknown(${s})`;

export type Clients = {
  rpcUrl: string;
  pub: PublicClient;
  wallet(account: PrivateKeyAccount): WalletClient<Transport, Chain, Account>;
};

export function clients(rpcUrl: string): Clients {
  const transport = http(rpcUrl, { timeout: 60_000, retryCount: 2 });
  const pub = createPublicClient({ chain: arbitrumSepolia, transport }) as PublicClient;
  return {
    rpcUrl,
    pub,
    wallet: (account) => createWalletClient({ account, chain: arbitrumSepolia, transport }),
  };
}

export const usdc = (atomic: bigint) => `${formatUsdc(atomic)} USDC`;
export const eth = (wei: bigint) => `${Number(formatEther(wei)).toFixed(6)} ETH`;
export const signedUsdc = (delta: bigint) => `${delta >= 0n ? "+" : "-"}${formatUsdc(delta >= 0n ? delta : -delta)} USDC`;

export async function usdcBalance(pub: PublicClient, who: Address): Promise<bigint> {
  return pub.readContract({ address: USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [who] });
}

/** Waits for a transaction and fails on revert. */
export async function mined(pub: PublicClient, hash: Hex | Promise<Hex>): Promise<TransactionReceipt> {
  const h = await hash;
  const receipt = await pub.waitForTransactionReceipt({ hash: h, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`transaction reverted: ${h}`);
  return receipt;
}

export async function readRelease(pub: PublicClient, registry: Address, releaseId: Hex) {
  return pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getRelease", args: [releaseId] });
}

export async function readWarranty(pub: PublicClient, registry: Address, resolutionId: Hex) {
  return pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getWarranty", args: [resolutionId] });
}

export async function readCredit(pub: PublicClient, registry: Address, who: Address): Promise<bigint> {
  return pub.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "credits", args: [who] });
}
