import { hashStruct, hashTypedData, type Address as ViemAddress, type Hex } from "viem";

import { ARBITRUM_SEPOLIA } from "./constants.js";
import type { OutcomeMessage, ResolutionVoucherMessage } from "./schemas.js";

export const EIP712_DOMAIN_NAME = "LemmaWarrantyRegistry";
export const EIP712_DOMAIN_VERSION = "1";

/** Must match the Solidity typehashes byte for byte. */
export const LEMMA_EIP712_TYPES = {
  ResolutionVoucher: [
    { name: "resolutionId", type: "bytes32" },
    { name: "releaseId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "paymentHash", type: "bytes32" },
    { name: "payloadDigest", type: "bytes32" },
    { name: "expiresAt", type: "uint64" },
  ],
  Outcome: [
    { name: "resolutionId", type: "bytes32" },
    { name: "result", type: "uint8" },
    { name: "evidenceDigest", type: "bytes32" },
  ],
} as const;

export const RESOLUTION_VOUCHER_TYPE =
  "ResolutionVoucher(bytes32 resolutionId,bytes32 releaseId,address buyer,uint256 amount,bytes32 paymentHash,bytes32 payloadDigest,uint64 expiresAt)";
export const OUTCOME_TYPE = "Outcome(bytes32 resolutionId,uint8 result,bytes32 evidenceDigest)";

export type LemmaDomain = {
  name: typeof EIP712_DOMAIN_NAME;
  version: typeof EIP712_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: ViemAddress;
};

export function lemmaDomain(verifyingContract: ViemAddress, chainId: number = ARBITRUM_SEPOLIA.chainId): LemmaDomain {
  return { name: EIP712_DOMAIN_NAME, version: EIP712_DOMAIN_VERSION, chainId, verifyingContract };
}

/** viem-ready voucher message (bigints for uint fields). */
export function voucherTypedMessage(v: ResolutionVoucherMessage) {
  return {
    resolutionId: v.resolutionId as Hex,
    releaseId: v.releaseId as Hex,
    buyer: v.buyer as ViemAddress,
    amount: BigInt(v.amount),
    paymentHash: v.paymentHash as Hex,
    payloadDigest: v.payloadDigest as Hex,
    expiresAt: BigInt(v.expiresAt),
  };
}

export function outcomeTypedMessage(o: OutcomeMessage) {
  return { resolutionId: o.resolutionId as Hex, result: o.result, evidenceDigest: o.evidenceDigest as Hex };
}

/** Full argument object for viem `signTypedData` / `verifyTypedData`. */
export function voucherTypedData(domain: LemmaDomain, v: ResolutionVoucherMessage) {
  return { domain, types: LEMMA_EIP712_TYPES, primaryType: "ResolutionVoucher" as const, message: voucherTypedMessage(v) };
}

export function outcomeTypedData(domain: LemmaDomain, o: OutcomeMessage) {
  return { domain, types: LEMMA_EIP712_TYPES, primaryType: "Outcome" as const, message: outcomeTypedMessage(o) };
}

export function voucherStructHash(v: ResolutionVoucherMessage): Hex {
  return hashStruct({ data: voucherTypedMessage(v), primaryType: "ResolutionVoucher", types: LEMMA_EIP712_TYPES });
}

export function outcomeStructHash(o: OutcomeMessage): Hex {
  return hashStruct({ data: outcomeTypedMessage(o), primaryType: "Outcome", types: LEMMA_EIP712_TYPES });
}

export function voucherTypedDataHash(domain: LemmaDomain, v: ResolutionVoucherMessage): Hex {
  return hashTypedData(voucherTypedData(domain, v));
}

export function outcomeTypedDataHash(domain: LemmaDomain, o: OutcomeMessage): Hex {
  return hashTypedData(outcomeTypedData(domain, o));
}
