# EIP-712 test vectors — ResolutionWarrantyRegistry

Source of truth: `test/Vectors.t.sol` (asserts every value below). Regenerate with
`forge test --match-contract VectorsTest -vv`. The TypeScript signer must reproduce these exactly.

## Types

```
ResolutionVoucher(bytes32 resolutionId,bytes32 releaseId,address buyer,uint256 amount,bytes32 paymentHash,bytes32 payloadDigest,uint64 expiresAt)
Outcome(bytes32 resolutionId,uint8 result,bytes32 evidenceDigest)
```

Domain: `name = "LemmaWarrantyRegistry"`, `version = "1"`, `chainId`, `verifyingContract`
(standard `EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)`, no salt).

`keccak256("x")` below means keccak256 of the UTF-8 bytes of the string (viem: `keccak256(toBytes("x"))`).

## Voucher vector

| Field | Value |
| --- | --- |
| resolutionId | `keccak256("res-1")` = `0xad1661cc88a9133dd1fc5f48e00493ef2214a83529c5000eeee4f78e227f0be7` |
| releaseId | `keccak256("x402-mcp-server@1")` = `0xc299d94f9df9014fb6da9825b528eb0ccb6fd45e40a9a55a7a2de33e2182a263` |
| buyer | `0x000000000000000000000000000000000000bEEF` |
| amount | `120000` (0.12 USDC, 6 decimals) |
| paymentHash | `keccak256("pay-1")` = `0x2f25d16bbf4e77f1eac9a0ef6bab0ff91326f4dc5cccbd98a80093476546b540` |
| payloadDigest | `keccak256("payload-1")` = `0x8b1d46224a22bf4e1ebbb1a576bb924cf35d3e6746be9eba2eff048ad12e181d` |
| expiresAt | `2000000000` |

| Output | Value |
| --- | --- |
| VOUCHER_TYPEHASH | `0xea72b9a58c0c2844af1fcc61526e73eb73abd4350774ae0058e2a7bba4c61c37` |
| **struct hash** (domain independent) | `0x58720dd088a3c544504c27a7818e9874ea98a19bc1a92ed51b311e4e13f06b53` |

The struct hash was cross-checked independently with `cast keccak` / `cast abi-encode`.

## Domain-bound values

Domain: chainId `421614` (Arbitrum Sepolia), verifyingContract
`0xF2E246BB76DF876Cef8b38ae84130F4F55De395b` (CREATE address of deployer
`0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf` = private key `1`, nonce 0).

| Output | Value |
| --- | --- |
| domainSeparator | `0xef868167cc691b7baf5196e6dbbdd43ffb1034fc912452de233fc8aae50f2484` |
| voucher digest (`hashVoucher`) | `0x3c5554bb185834a5ae90a4c34237e9a21f44e1de520c2e3115539a6948b8e825` |
| provider signature over digest, key `0xA11CE` (address `0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7`), `r‖s‖v` | `0xab1d5504510dafe029e7402569e386a73c3eebd1acbeca109a0ad3dd3246b04a131c831d89ba4a0ee48aa9847673b744747b466bb7c5d7a27927d39f30e49c001c` |

RFC 6979 deterministic ECDSA (viem/ethers/noble default) produces the same signature.

## Outcome vector

Same domain as above.

| Field | Value |
| --- | --- |
| resolutionId | `keccak256("res-1")` |
| result | `2` (Failed; `1` = Passed) |
| evidenceDigest | `keccak256("evidence-1")` = `0x35131a1a987becc7ee7bc7f60652fabb72e3692d9683b962658089c902e7df5c` |

| Output | Value |
| --- | --- |
| OUTCOME_TYPEHASH | `0x54c43de78058fb4d4a3712076a0bd7303296ed7ea40ab4d881d26a04a2fdc34c` |
| struct hash | `0xf1d0c01c77862dbe67893c96282aced365e6326a23d38ced288f4437cbc7d706` |
| digest (`hashOutcome`) | `0x4b83930dab97ae19506a8f347fd192e763520a81d3ba3d361c02e42645079f78` |
