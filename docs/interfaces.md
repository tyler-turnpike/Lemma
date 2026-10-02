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
- `resolution.paymentHash` is the settlement transaction hash. `voucher.voucher.paymentHash` holds the same value.
- The voucher is signed by the provider key over the EIP-712 `ResolutionVoucher` type with domain `lemmaDomain(registryAddress, 421614)`. `amount` equals the release price, and `payloadDigest` equals `bundleDigest(resolution.bundle)`.
- `voucher.voucher.expiresAt` is settlement time + 24 hours (unix seconds) and equals `resolution.expiresAt`.
- The x402 payer (`authorization.from` of the EIP-3009 payload) must equal `buyer`; otherwise the server refuses before verification (`payer_mismatch`).
- `previewId` is a random 32-byte server identifier and a preview is purchasable for 30 minutes after it is issued. Treat it as a bearer value: `(previewId, buyer)` is what recovery needs.
- The paid response carries the signed voucher directly. The `@x402/mcp` wrapper settles after the tool handler but before returning, and the server signs the voucher in its `onAfterSettlement` hook, so `paymentHash` is the real settlement transaction. The x402 `SettleResponse` is also in `_meta["x402/payment-response"]`. If the response is lost, `lemma_recover_resolution` returns the identical objects.
- Tool errors are results with `isError: true` and `{ error: { code, message } }` (codes include `preview_not_found`, `preview_expired`, `not_purchasable`, `release_unavailable`, `already_settled`, `purchase_in_progress`, `payer_mismatch`, `paid_tools_disabled`, `invalid_signature`, `buyer_mismatch`, `resolution_not_found`). An x402 payment challenge is the standard `PaymentRequired` result (`structuredContent` with `x402Version` and `accepts`).

## Read-only HTTP API

- `GET /health` returns `{ ok, version }` (503 when the database is unreachable).
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

Bridge-side rules that depend on the server:

- The bridge sends `buyer` = its own wallet address and pays from the same wallet, so the server's `payer_mismatch` check always holds for a correct bridge.
- Before paying it reads `GET /api/v1/status` and refuses when `registry` differs from its `RESOLUTION_WARRANTY_REGISTRY_ADDRESS` (otherwise the voucher would be rejected only after payment).
- A paid call answered with an x402 PaymentRequired means verification refused the payment (no settlement) unless its `error` starts with `Payment settlement failed`, which is treated as ambiguous and handled by recovery.
- `already_settled` before payment, or any failure after a payment was authorized, leads to `lemma_recover_resolution`, never a second payment.

The whole contract is exercised end to end by `npm run demo:fork`.
