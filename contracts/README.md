# Lemma Warranty Contracts

## Purpose and economic role

This Foundry project will contain the Arbitrum Sepolia registry that makes a paid Compatibility Resolution more than a reputation claim. The provider deposits USDC bond capital, and an eligible evaluator-confirmed failure converts reserved bond into buyer withdrawal credit.

x402 remains the payment rail. The contract provides bounded recourse after payment rather than replacing x402 with a custom escrow scheme.

## Responsibilities

- Register versioned Capability Releases and their provider and evaluator roles.
- Hold provider USDC bonds.
- Activate provider-signed Resolution Vouchers after x402 settlement.
- Reserve one resolution's warranty amount from its release bond.
- Finalize evaluator-signed pass or failure outcomes.
- Release reserved bond on pass or expiry.
- Credit the buyer on an eligible failure.
- Support pull-based withdrawals, pause, and release deactivation.

## Outside this boundary

- Storing patch payloads or repository profiles in plaintext.
- Verifying historical USDC logs inside Solidity.
- Determining software correctness directly.
- Pricing resolutions.
- Operating the x402 facilitator.
- Open governance or a protocol token.

## Status

`src/ResolutionWarrantyRegistry.sol` is implemented and tested (unit, fuzz, invariant, fixed EIP-712 vectors). Not yet deployed to Arbitrum Sepolia; `npm run demo:fork` rehearses the deployment on a fork.

## Public interface

`ResolutionWarrantyRegistry(IERC20 usdc, address admin)` — OpenZeppelin `AccessControl` (`DEFAULT_ADMIN_ROLE`), `EIP712("LemmaWarrantyRegistry", "1")`, `Pausable`, `ReentrancyGuard`.

| Operation | Caller | Effect |
| --- | --- | --- |
| `registerRelease(releaseId, provider, evaluator, price, claimWindow)` | admin | New active release; `claimWindow = 0` means 72h (max 30 days). |
| `depositBond(releaseId, amount)` | provider | `transferFrom` into `availableBond`. Blocked when paused or release inactive. |
| `withdrawUnreservedBond(releaseId, amount)` | provider | From `availableBond` only; reserved bond is never withdrawable. |
| `deactivateRelease(releaseId)` | admin or provider | Stops new activations; existing warranties still finalize/expire. |
| `activateResolution(Voucher, providerSig)` | `msg.sender == voucher.buyer` | Checks expiry, provider EIP-712 signature, `amount == price`, unused `resolutionId` and `paymentHash`, bond; moves `amount` available -> reserved; claim deadline = now + claimWindow. Blocked when paused. |
| `finalizeOutcome(Outcome, evaluatorSig)` | anyone | Evaluator-signed, before deadline. Pass (1): reserved -> available. Fail (2): reserved -> `credits[buyer]`. |
| `expireResolution(resolutionId)` | anyone | After deadline: Active -> Expired, reserved -> available. |
| `withdrawCredit()` | buyer | Pull payment of full credit. |
| `pause()` / `unpause()` | admin | Pause gates deposits and activations only; outcomes, expiry and withdrawals keep working. |

Views: `getRelease`, `getWarranty`, `credits`, `paymentHashUsed`, `totalAvailableBond`, `totalReservedBond`, `totalCredits`, `domainSeparator`, `voucherStructHash`, `outcomeStructHash`, `hashVoucher`, `hashOutcome` (full EIP-712 digests).

Signatures are 65-byte ECDSA (`r‖s‖v`) from EOAs. ERC-1271 contract signers are not supported because OpenZeppelin's `SignatureChecker` needs the Cancun `MCOPY` opcode and this project compiles for Shanghai.

EIP-712 types and cross-language test vectors: [`test/vectors.md`](test/vectors.md).

## Dependencies

Git submodules in `lib/` (pins in `foundry.lock`): forge-std `v1.17.0`, OpenZeppelin Contracts `v5.4.0` (v5.5+ uses `MCOPY` in `SignatureChecker`/`Bytes`, which does not compile for Shanghai). After cloning run `git submodule update --init --recursive`. Note that the root `.gitignore` lists `contracts/lib/`; the submodule gitlinks were added with `git add -f`.

## Environment variables

Foundry uses `ARBITRUM_SEPOLIA_RPC_URL`.

- `script/Deploy.s.sol:Deploy`: `DEPLOYER_PRIVATE_KEY`, `USDC_ADDRESS`, `REGISTRY_ADMIN_ADDRESS`, optional `EXPECTED_CHAIN_ID` (default 421614), optional `SOURCE_COMMIT`, optional `DEPLOYMENT_FILE` (default `deployments/<chainId>.json`; fork rehearsals use `deployments/fork-421614.json`, gitignored). On chain 421614 the USDC address must be `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`; the token must have 6 decimals. Writes `deployments/<chainId>.json` (no secrets).
- `script/RegisterRelease.s.sol:RegisterRelease`: `ADMIN_PRIVATE_KEY` (falls back to `DEPLOYER_PRIVATE_KEY`), `REGISTRY_ADDRESS`, `RELEASE_ID` (bytes32) or `RELEASE_KEY` (string, keccak256-hashed), `PROVIDER_ADDRESS`, `EVALUATOR_ADDRESS`, `RELEASE_PRICE` (6-decimal units), optional `CLAIM_WINDOW` (seconds).
- `script/RegisterRelease.s.sol:DepositBond`: `PROVIDER_PRIVATE_KEY`, `REGISTRY_ADDRESS`, `RELEASE_ID` or `RELEASE_KEY`, `BOND_AMOUNT`.

## Development and tests

From the Lemma root:

- `npm run contracts:build`
- `npm run contracts:test`

Or directly from `contracts/`: `forge test` (add `-vv --match-contract VectorsTest` to print the vectors).

Operators normally use `npm run testnet:setup` (root `scripts/testnet-setup.ts`), which runs the Deploy script and then registers and bonds both catalog releases; see `docs/deployment.md`. Manual equivalent:

```sh
cd contracts
forge script script/Deploy.s.sol:Deploy --rpc-url arbitrum_sepolia --broadcast
forge script script/RegisterRelease.s.sol:RegisterRelease --rpc-url arbitrum_sepolia --broadcast
forge script script/RegisterRelease.s.sol:DepositBond --rpc-url arbitrum_sepolia --broadcast
```

## Security constraints

- Use EIP-712 domain separation with chain and contract binding.
- Reject expired vouchers, replayed resolution IDs, replayed payment hashes, wrong buyers, and wrong evaluators.
- Require warranty amount to equal the covered price for the MVP.
- Keep reserved bond unavailable to provider withdrawal.
- Use pull credits and reentrancy protection.
- Preserve active warranties when a release is deactivated.
- Maintain `USDC balance >= available bond + reserved bond + withdrawal credits`.
- Test six-decimal token accounting explicitly.

## Later completion criteria

The contract is complete when unit, fuzz, and invariant tests cover the full state machine, deployed bytecode is verified on Arbitrum Sepolia, and a real paid resolution can demonstrate both pass and refundable failure paths.
