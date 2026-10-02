# Lemma Core

## Purpose and economic role

Core defines the shared language that prevents the server, bridge, dashboard, benchmark, and contract bindings from disagreeing about what was sold. Stable schemas and canonical identifiers are required for payments, signatures, warranties, and reproducible evidence.

## Responsibilities

- Define versioned schemas for repository profiles, releases, previews, resolutions, vouchers, and receipts.
- Define decision, evidence, outcome, and warranty status enums.
- Canonicalize JSON and derive Keccak identifiers.
- Define pricing and spending-policy value types without floating-point currency.
- Provide shared validation and secret-redaction helpers.

## Outside this boundary

- Network requests.
- Database access.
- Filesystem scanning (the `node` subpath only applies already-verified bundles and runs recipes).
- Wallet signing.
- Matching against a concrete catalog.
- User-interface rendering.

## Public interface (status: implemented)

`@lemma/core` (browser-safe):

- Strict Zod 4 schemas and inferred types: `RepositoryProfile`, `TaskRequest`, `CapabilityRelease`, `AcceptanceRecipe`, `PatchBundle`, `Preview`, `CompatibilityResolution`, `ResolutionVoucherMessage`, `OutcomeMessage`, `SignedResolutionVoucher`, `SignedOutcome`, `AdoptionReceipt`, `SignedAdoptionReceipt`. Unknown fields are rejected; every signed or paid object carries `schemaVersion: "1"`.
- Canonical JSON (RFC 8785) and keccak digests: `canonicalJson`, `digest`, `bundleDigest`, `adoptionReceiptDigest`, `releaseIdFor`, `newResolutionId`.
- USDC atomic amounts: `parseUsdc`, `formatUsdc`, `parseAtomic`.
- Policy: `evaluateSpend` (pure, fail-closed) and `isPriceJustified` (price <= 30% of measured saving).
- EIP-712: `lemmaDomain`, `LEMMA_EIP712_TYPES`, `voucherStructHash`, `voucherTypedDataHash`, `outcomeStructHash`, `outcomeTypedDataHash`, `voucherTypedData`, `outcomeTypedData`. Vectors in `test/vectors.json` are asserted against the Solidity values in `contracts/test/vectors.md`.
- Profiles and paths: `profileFromPackageJson`, `nonNodeProfile`, `validateBundlePath`, minimal semver (`satisfiesRange`).
- Redaction: `redact`, `redactString`, `secretsFromEnv`.

`@lemma/core/node` (filesystem and process; Node only):

- `applyBundle(dir, bundle, { dryRun })`: path confinement, symlink rejection, drift detection, structured `package.json` dependency merge, staged writes with rollback. Dry run by default.
- `runAcceptance(dir, recipe)`: argv-only spawn without a shell, allowlisted environment, shared timeout, redacted capped output.

Timestamps in JSON documents are ISO-8601 UTC strings; only the EIP-712 voucher uses uint64 seconds.

## Workspace dependencies

- Zod for runtime validation.
- `json-canonicalize` for deterministic serialization.
- viem utilities for Ethereum-compatible hashes and values.

## Environment variables

None. Core must remain deterministic and environment-independent.

## Development and tests

- `npm run build -w @lemma/core`
- `npm run test -w @lemma/core`

## Security constraints

- Parse untrusted values rather than casting them.
- Reject unknown fields on signed and paid payloads.
- Represent USDC amounts as integers in atomic units.
- Version every signed structure.
- Keep canonicalization test vectors shared with Solidity encoding tests.

## Later completion criteria

Core is complete when every application imports one canonical schema set, cross-language digest vectors match, invalid paid payloads fail closed, and schema migration rules are documented.
