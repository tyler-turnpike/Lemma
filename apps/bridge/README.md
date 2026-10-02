# Lemma Local MCP Bridge

## Purpose and economic role

The bridge is the user-facing MCP server installed beside a coding agent. It injects verified prior work into the agent's workflow while keeping repository access, wallet authority, spending limits, and patch application under local control.

The bridge is what turns a hosted resolution service into a useful agent capability. A plain remote MCP connection would not safely hold the buyer wallet or inspect local compatibility.

## Responsibilities

- Run as a local stdio MCP server.
- Read an allowlisted repository profile from the configured workspace.
- Expose preview, purchase, apply, and verification tools.
- Connect to the hosted MCP endpoint as an x402-capable client.
- Enforce per-resolution and daily spending limits before signing.
- Verify resolution signatures and payload digests.
- Preview or atomically apply safe patch bundles.
- Run catalog-pinned acceptance recipes under limits.
- Sign Adoption Receipts with the buyer wallet.
- Activate onchain warranty vouchers and recover interrupted purchases.

## Outside this boundary

- Deciding that an unsupported profile is compatible.
- Sending arbitrary source files to the server.
- Accepting payment instructions from untrusted prose.
- Executing shell strings supplied by a Capability Release.
- Holding provider, facilitator, evaluator, or deployer keys.

## Status

Implemented. `lemma-mcp` is a stdio MCP server exposing four tools. It talks to the hosted
endpoint at `${LEMMA_API_URL}/mcp` (Streamable HTTP) as an x402 MCP client, per
[docs/interfaces.md](../../docs/interfaces.md). Tested against an in-process fake Lemma
server and fake x402 layer (`apps/bridge/test`); not yet exercised against the live
server and chain.

## MCP tools

| Tool | Input | Does |
|---|---|---|
| `lemma_preview` | `{ kind }` (task kind) | Builds the profile from allowlisted files only, calls remote `lemma_preview`, stores the preview locally, and reports price, warranty and whether local spend policy would allow a purchase. Free. |
| `lemma_buy_resolution` | `{ previewId }` | Checks local spend policy, pays through x402 (only if the payment request matches the preview), verifies digest and voucher signer, activates the warranty on chain, stores everything in `LEMMA_STATE_DIR`. Recovers instead of re-paying after a lost response or restart. |
| `lemma_apply_resolution` | `{ resolutionId, apply? }` | `applyBundle` on the workspace. Dry run unless `apply: true`. Returns the change list. |
| `lemma_verify_adoption` | `{ resolutionId }` | Requires the bundle to be applied, runs the pinned acceptance recipe, signs an `AdoptionReceipt` (EIP-191 over `adoptionReceiptDigest`) with the buyer key, submits it via remote `lemma_submit_receipt`. |

Every tool returns a short text summary plus `structuredContent`. Failures return
`isError: true` with `{ error: { code, message } }`, scrubbed of secrets.

### Purchase safety

- The spend check runs before any signature: price <= `LEMMA_MAX_USDC_PER_RESOLUTION`, today's
  spend + price <= `LEMMA_DAILY_USDC_CAP` (UTC day, from `ledger.json`), network
  `eip155:421614`, token == `USDC_ADDRESS`, `payTo` == `LEMMA_PROVIDER_ADDRESS`, amount == the
  previewed price, `exact` scheme with an EIP-3009 authorization.
- The same check is wired into the x402 client as the `onPaymentRequested` approval hook, a
  payment policy, and a before-payment-creation hook. If the server asks for anything other
  than the previewed price and recipient, nothing is signed. One payment per buy call, at most.
- The spend is written to the ledger (atomic write, one entry per `previewId`) before the
  approval returns. After that, a timeout, dropped connection, or error never leads to a
  second payment. The bridge calls `lemma_recover_resolution` instead, now and on any later
  `lemma_buy_resolution` for that preview.
- The delivered resolution must pass schema validation, `bundleDigest(bundle) ==
  resolution.payloadDigest == voucher.payloadDigest`, and bundle integrity. The voucher signer
  is recovered from the EIP-712 signature and must equal `LEMMA_PROVIDER_ADDRESS`. Buyer, amount,
  release, preview, chain and registry must all match. Rejected payloads go to
  `LEMMA_STATE_DIR/quarantine/` and are never applied.
- Warranty activation calls `activateResolution(voucher, signature)` on the registry from the
  buyer wallet and waits for the receipt. If `RESOLUTION_WARRANTY_REGISTRY_ADDRESS` or
  `ARBITRUM_SEPOLIA_RPC_URL` is unset, activation is skipped with a warning. A later
  `lemma_buy_resolution` retries a skipped or failed activation without paying again. The
  buyer wallet needs Arbitrum Sepolia ETH for gas.

## Install

```bash
npm install
npm run build -w @lemma/bridge   # emits apps/bridge/dist/index.js (the lemma-mcp bin)
```

The examples below run `node /absolute/path/to/Lemma/apps/bridge/dist/index.js`. Put the
buyer key only in the MCP client's env block for this server. It is never sent to the model.

### Environment variables

| Variable | Default | Notes |
|---|---|---|
| `LEMMA_API_URL` | `http://localhost:3000` | Hosted server; MCP endpoint is `${LEMMA_API_URL}/mcp` |
| `LEMMA_WORKSPACE` | process cwd | Repository to profile, patch and test |
| `BUYER_PRIVATE_KEY` | none | Testnet buyer wallet; required to buy and sign receipts |
| `LEMMA_PROVIDER_ADDRESS` | none | Expected `payTo` and voucher signer; required to buy |
| `LEMMA_MAX_USDC_PER_RESOLUTION` | `0.25` | Per-resolution cap (decimal USDC) |
| `LEMMA_DAILY_USDC_CAP` | `1.00` | Daily cap, persisted across restarts |
| `USDC_ADDRESS` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | Arbitrum Sepolia USDC |
| `RESOLUTION_WARRANTY_REGISTRY_ADDRESS` | none | Registry for voucher domain check and activation |
| `ARBITRUM_SEPOLIA_RPC_URL` | none | Needed for warranty activation; treated as a secret |
| `LEMMA_STATE_DIR` | `~/.lemma` | Ledger, previews, resolutions, receipts, quarantine (files are 0600) |

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "lemma": {
      "command": "node",
      "args": ["/absolute/path/to/Lemma/apps/bridge/dist/index.js"],
      "env": {
        "LEMMA_API_URL": "https://lemma.example.com",
        "LEMMA_WORKSPACE": "/absolute/path/to/your/repo",
        "BUYER_PRIVATE_KEY": "0x...",
        "LEMMA_PROVIDER_ADDRESS": "0x...",
        "RESOLUTION_WARRANTY_REGISTRY_ADDRESS": "0x...",
        "ARBITRUM_SEPOLIA_RPC_URL": "https://sepolia-rollup.arbitrum.io/rpc",
        "LEMMA_MAX_USDC_PER_RESOLUTION": "0.25",
        "LEMMA_DAILY_USDC_CAP": "1.00"
      }
    }
  }
}
```

### Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.lemma]
command = "node"
args = ["/absolute/path/to/Lemma/apps/bridge/dist/index.js"]

[mcp_servers.lemma.env]
LEMMA_API_URL = "https://lemma.example.com"
LEMMA_WORKSPACE = "/absolute/path/to/your/repo"
BUYER_PRIVATE_KEY = "0x..."
LEMMA_PROVIDER_ADDRESS = "0x..."
RESOLUTION_WARRANTY_REGISTRY_ADDRESS = "0x..."
ARBITRUM_SEPOLIA_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc"
```

### Claude Code

```bash
claude mcp add lemma \
  -e LEMMA_API_URL=https://lemma.example.com \
  -e LEMMA_WORKSPACE="$PWD" \
  -e BUYER_PRIVATE_KEY=0x... \
  -e LEMMA_PROVIDER_ADDRESS=0x... \
  -e RESOLUTION_WARRANTY_REGISTRY_ADDRESS=0x... \
  -e ARBITRUM_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc \
  -- node /absolute/path/to/Lemma/apps/bridge/dist/index.js
```

## Workspace dependencies

- `@lemma/core` for shared schemas, digests, spend policy, `applyBundle` and `runAcceptance`.
- The MCP SDK for the local stdio server and hosted client.
- `@x402/mcp`, `@x402/core` and `@x402/evm` (`ExactEvmScheme`) for payment creation and response handling.
- viem for buyer signing, voucher signer recovery and warranty activation.
- zod for configuration and tool input validation.

## Source layout

- `src/index.ts`: `lemma-mcp` bin (stdio).
- `src/bridge.ts`: wiring.
- `src/server.ts`: tool definitions.
- `src/operations.ts`: preview, buy/recover, apply, verify.
- `src/policy.ts`: spend checks and the x402 payment guard.
- `src/ledger.ts`: persistent daily spend.
- `src/remote.ts`: x402 MCP client.
- `src/verify.ts`: resolution and voucher verification.
- `src/chain.ts`: registry ABI and activation.
- `src/profile.ts`: allowlisted profile.
- `src/state.ts`: atomic local state.
- `src/redaction.ts`: scrubbing and stderr logger.

## Development and tests

- `npm run dev -w @lemma/bridge`
- `npm run build -w @lemma/bridge`
- `npm run test -w @lemma/bridge` (or `npx vitest run apps/bridge` from the repo root)

Logs go to stderr only (stdout carries MCP), and every line is scrubbed.

## Security constraints

- Canonicalize every filesystem path and keep it inside the workspace root.
- Reject symlinks, absolute paths, parent traversal, protected files, and binary mutations.
- Read only reviewed manifest and lockfile names during profile creation.
- Validate network, token, recipient, amount, expiry, and local budgets before signing.
- Apply patches atomically and fail on base-file drift.
- Spawn acceptance commands without a shell, with an allowlisted environment, timeout, and output limit.
- Scrub all sensitive values from errors and receipts.

## Later completion criteria

This component is complete when a supported coding agent can install it, receive a free preview, make one policy-compliant testnet purchase, recover it after an injected connection failure, preview and apply the signed patch, run the acceptance recipe, and submit a signed receipt without exposing repository source or keys.
