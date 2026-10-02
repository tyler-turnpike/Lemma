# Bridge ↔ Server Interface

This is the contract between the local bridge (`apps/bridge`) and the hosted server (`apps/server`). Schemas come from `@lemma/core`; everything crossing the wire is validated on both sides.

## Network constants

- Chain: Arbitrum Sepolia, `eip155:421614`.
- Token: USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`, 6 decimals, atomic integer strings.
- x402 scheme: `exact`. Payment recipient (`payTo`) is the provider address.

## Remote MCP endpoint

Streamable HTTP at `POST {LEMMA_API_URL}/mcp`. Every tool declares an `inputSchema` and returns JSON in `structuredContent`, with the same JSON as a text content block.

| Tool | Paid | Input | Output |
|---|---|---|---|
| `lemma_preview` | no | `{ task: TaskRequest, profile: RepositoryProfile }` | `Preview` (persisted, has `previewId`) |
| `lemma_purchase_resolution` | **x402** | `{ previewId, buyer }` | `{ resolution: CompatibilityResolution, voucher: SignedResolutionVoucher }` |
| `lemma_recover_resolution` | no | `{ previewId, buyer }` | same as purchase, or `{ found: false }` |
| `lemma_submit_receipt` | no | `SignedAdoptionReceipt` | `{ accepted: true, receiptId }` |

Rules:

- The x402 amount required by `lemma_purchase_resolution` equals the preview's `priceAtomic`. The server refuses before payment when the preview is missing, expired, not purchasable, or already settled for that `(previewId, buyer)`. In the already-settled case the error says to call `lemma_recover_resolution`.
- One settled purchase per `(previewId, buyer)`. Recovery returns that exact resolution and voucher, so a lost response never causes a second payment.
- `resolution.paymentHash` is the settlement transaction hash. `voucher.message.paymentHash` holds the same value.
- The voucher is signed by the provider key over the EIP-712 `ResolutionVoucher` type with domain `lemmaDomain(registryAddress, 421614)`. `amount` equals the release price, and `payloadDigest` equals `bundleDigest(resolution.bundle)`.

## Read-only HTTP API

- `GET /health` returns `{ ok, version }`.
- `GET /api/v1/status` returns chain, USDC, registry, provider, facilitator and evaluator public addresses, plus the trust notice.
- `GET /api/v1/releases` and `GET /api/v1/releases/:id`.
- `GET /api/v1/resolutions/:resolutionId` returns the resolution summary, payment tx, voucher and receipt status. It never returns the patch bundle.
- `GET /api/v1/adoption-receipts?resolutionId=`.
- `GET /api/v1/benchmarks` returns the published aggregate, or `{ status: "not-run" }`.

## Facilitator

Self-hosted at `/facilitator/supported`, `/facilitator/verify` and `/facilitator/settle`, signing with `FACILITATOR_PRIVATE_KEY`, single replica.

## Bridge tools (local stdio MCP, exposed to the coding agent)

| Tool | Does |
|---|---|
| `lemma_preview` | Builds the profile from the workspace (allowlisted files only) and calls remote `lemma_preview` |
| `lemma_buy_resolution` | Checks the spend policy locally, then pays through x402, verifies the payload digest and voucher signer, activates the warranty on chain, and stores the resolution locally. Recovers automatically after a lost response. |
| `lemma_apply_resolution` | `applyBundle`, with `dryRun` defaulting to true |
| `lemma_verify_adoption` | `runAcceptance`, then signs an `AdoptionReceipt` (EIP-191 over `adoptionReceiptDigest`) and submits it |
