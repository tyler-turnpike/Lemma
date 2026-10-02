# Lemma Capability Catalog

## Purpose and economic role

The catalog contains the productive assets Lemma can resolve against. Each Capability Release packages open-source provenance with a narrow supported profile, deterministic adaptation, acceptance evidence, a price, an expiry, and warranty terms.

The catalog is curated during the MVP. Publishing a file is not enough to create a sellable release.

## Responsibilities

- Store versioned Capability Release manifests.
- Store reviewed patch templates and acceptance recipes.
- Store positive, boundary, and negative compatibility fixtures.
- Record upstream source commits, SPDX licenses, attribution, and modification notes.
- Record measured savings evidence and its benchmark version.
- Validate catalog integrity before server startup.

## Outside this boundary

- Open provider onboarding.
- Dynamic pricing.
- Payment settlement.
- Buyer-specific repository content.
- Runtime warranty adjudication.

## Public interface (status: two provisional releases)

`loadCatalog()` validates every manifest with the core schemas, rebuilds each patch bundle from `releases/<id>/payload/`, rejects undeclared payload files and symlinks, and fails closed unless the computed bundle digest equals the manifest `payloadDigest`. The returned catalog exposes `listReleases()`, `getRelease(id | releaseId)`, `getBundle(id)`, `listFixtures()`, `fixtureDir(id)` and `fixtureProfile(id)`.

Releases:

- `x402-mcp-server@1.0.0`: x402 payment gating (USDC on Arbitrum Sepolia) for a TypeScript MCP server.
- `x402-mcp-client@1.0.0`: an x402-paying MCP client with per-call, total-budget and recipient limits.

Both use the upstream x402 TypeScript SDK 2.27.0 (`x402-foundation/x402` at commit `71eb9a55e081e7b81ba3046d0bd17c3eb9c7bf81`, Apache-2.0). They are priced at 0.12 USDC with an equal bond. Their evidence is `provisional` because no benchmark has been run yet, so the resolver previews them but does not mark them purchasable unless the testnet override is set.

After editing a payload or an exact fixture, run `npm run seal -w @lemma/catalog` to recompute `baseSha256` and `payloadDigest`, and review the diff. `test/fixtures.e2e.test.ts` copies each positive fixture to a temp workspace, shows that the release acceptance test fails before the patch, applies the bundle, and checks that the acceptance test passes afterwards.

## Workspace dependencies

- `@lemma/core` for schemas and identifiers.
- Zod for catalog validation.

## Environment variables

None. A catalog build must be reproducible without network access or secrets.

## Development and tests

- `npm run build -w @lemma/catalog`
- `npm run test -w @lemma/catalog`

## Security constraints

- Require explicit license and provenance fields.
- Reject mutable source references for publishable releases.
- Hash every payload and acceptance recipe.
- Forbid arbitrary command strings, remote downloads, absolute paths, and secret-bearing fixtures.
- Keep benchmark evidence distinct from marketing claims.

## Later completion criteria

The catalog is complete for the MVP when at least two releases have valid manifests, signed payload digests, exact and negative fixtures, deterministic acceptance recipes, provenance reviews, expiry rules, and frozen benchmark evidence.
