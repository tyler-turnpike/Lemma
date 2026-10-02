import { readFileSync } from "node:fs";
import { hashDomain, keccak256, pad, recoverTypedDataAddress, toBytes, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import {
  LEMMA_EIP712_TYPES,
  OUTCOME_TYPE,
  RESOLUTION_VOUCHER_TYPE,
  ResolutionVoucherMessage,
  lemmaDomain,
  outcomeStructHash,
  outcomeTypedData,
  outcomeTypedDataHash,
  voucherStructHash,
  voucherTypedData,
  voucherTypedDataHash,
  type OutcomeMessage,
} from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));
const k = (s: string) => keccak256(toBytes(s));

const voucher = ResolutionVoucherMessage.parse({
  resolutionId: k("res-1"),
  releaseId: k("x402-mcp-server@1"),
  buyer: "0x000000000000000000000000000000000000bEEF",
  amount: "120000",
  paymentHash: k("pay-1"),
  payloadDigest: k("payload-1"),
  expiresAt: "2000000000",
});
const domain = lemmaDomain(vectors.domain.verifyingContract, vectors.domain.chainId);

describe("EIP-712 voucher vector (shared with Solidity)", () => {
  it("derives the documented message inputs", () => {
    expect(voucher).toEqual(vectors.voucher.message);
  });

  it("matches the Solidity typehashes", () => {
    expect(keccak256(toBytes(RESOLUTION_VOUCHER_TYPE))).toBe(vectors.voucher.typeHash);
    expect(keccak256(toBytes(OUTCOME_TYPE))).toBe(vectors.outcome.typeHash);
    expect(LEMMA_EIP712_TYPES.ResolutionVoucher.map((f) => `${f.type} ${f.name}`).join(",")).toBe(
      RESOLUTION_VOUCHER_TYPE.slice("ResolutionVoucher(".length, -1),
    );
  });

  it("computes the struct hash", () => {
    expect(voucherStructHash(voucher)).toBe(vectors.voucher.structHash);
    expect(voucherStructHash(voucher)).toBe("0x58720dd088a3c544504c27a7818e9874ea98a19bc1a92ed51b311e4e13f06b53");
  });

  it("computes the domain separator and typed-data digest", () => {
    expect(
      hashDomain({
        domain,
        types: { EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ] },
      }),
    ).toBe(vectors.voucher.domainSeparator);
    expect(voucherTypedDataHash(domain, voucher)).toBe(vectors.voucher.typedDataHash);
  });

  it("reproduces the provider signature (RFC 6979) and recovers the signer", async () => {
    const account = privateKeyToAccount(pad(toHex(BigInt(vectors.voucher.providerTestPrivateKey))) as Hex);
    expect(account.address).toBe(vectors.voucher.providerAddress);
    const signature = await account.signTypedData(voucherTypedData(domain, voucher));
    expect(signature).toBe(vectors.voucher.providerSignature);
    expect(signature.length).toBe(132);
    const recovered = await recoverTypedDataAddress({ ...voucherTypedData(domain, voucher), signature });
    expect(recovered).toBe(vectors.voucher.providerAddress);
  });

  it("changes the digest when any bound field changes", () => {
    expect(voucherStructHash({ ...voucher, amount: "120001" })).not.toBe(vectors.voucher.structHash);
    expect(voucherTypedDataHash(lemmaDomain(vectors.domain.verifyingContract, 1), voucher)).not.toBe(vectors.voucher.typedDataHash);
  });
});

describe("EIP-712 outcome vector", () => {
  const outcome: OutcomeMessage = { resolutionId: k("res-1"), result: 2, evidenceDigest: k("evidence-1") };
  it("matches struct hash and digest", () => {
    expect(outcome).toEqual(vectors.outcome.message);
    expect(outcomeStructHash(outcome)).toBe(vectors.outcome.structHash);
    expect(outcomeTypedDataHash(domain, outcome)).toBe(vectors.outcome.typedDataHash);
    expect(outcomeTypedData(domain, outcome).primaryType).toBe("Outcome");
  });
});
