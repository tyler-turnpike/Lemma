import { Address, Bytes32, RepositoryProfile, SignedAdoptionReceipt, TaskRequest } from "@lemma/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { extractPaymentFromMeta } from "@x402/mcp";
import { getAddress } from "viem";

import type { Logger } from "./log.js";
import { PURCHASE_TOOL, SUCCESS_FEE_TOOL, type PaymentGateway } from "./payments/x402.js";
import { ResolverInputError } from "./resolver.js";
import { LemmaService, ServiceError, payerOf } from "./service.js";

export const SERVER_INFO = { name: "lemma", version: "0.1.0" } as const;

type Json = Record<string, unknown>;

export function ok(data: Json): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

export function fail(code: string, message: string): CallToolResult {
  const data = { error: { code, message } };
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: true };
}

function toFailure(error: unknown, logger: Logger, tool: string): CallToolResult {
  if (error instanceof ServiceError) return fail(error.code, error.message);
  if (error instanceof ResolverInputError) return fail("invalid_input", error.message);
  logger.error("tool failed", { tool, error: error instanceof Error ? error.message : String(error) });
  return fail("internal_error", "internal error");
}

export type McpDeps = {
  service: LemmaService;
  gateway: PaymentGateway | undefined;
  paidDisabledReason: string | null;
  logger: Logger;
};

const PurchaseInput = { previewId: Bytes32, buyer: Address };
const SuccessFeeInput = { resolutionId: Bytes32, buyer: Address };
/** Optional, self-declared: the model the buyer's agent runs, used only to scale the quote. */
const PricingInput = z.strictObject({ model: z.string().min(1).max(64).optional() }).optional();

/**
 * Builds a fresh MCP server with the five Lemma tools. Used per request in stateless
 * Streamable HTTP mode.
 */
export function createMcpServer(deps: McpDeps): McpServer {
  const { service, logger } = deps;
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

  server.registerTool(
    "lemma_preview",
    {
      description:
        "Free. Resolve a typed task and allowlisted repository profile against the curated catalog. Returns a persisted Preview. Pass pricing.model (the agent's model) to get a quote scaled to your expected saving: priceAtomic is paid up front, quote.successFeeAtomic only after the acceptance tests pass.",
      inputSchema: { task: TaskRequest, profile: RepositoryProfile, pricing: PricingInput },
    },
    async ({ task, profile, pricing }) => {
      try {
        return ok(await service.preview(task, profile, pricing ?? {}));
      } catch (error) {
        return toFailure(error, logger, "lemma_preview");
      }
    },
  );

  server.registerTool(
    PURCHASE_TOOL,
    {
      description:
        "Paid via x402 (exact, USDC on Arbitrum Sepolia, amount = preview priceAtomic). Returns the Compatibility Resolution and a provider-signed warranty voucher bound to the settlement transaction.",
      inputSchema: PurchaseInput,
    },
    async (args, extra) => {
      if (deps.gateway === undefined || deps.paidDisabledReason !== null) {
        return fail("paid_tools_disabled", deps.paidDisabledReason ?? "paid tools are disabled");
      }
      const gateway = deps.gateway;
      let release: (() => void) | undefined;
      try {
        // Refuse before any payment is requested or verified.
        const check = await service.checkPurchasable(args.previewId, args.buyer);
        const payment = extractPaymentFromMeta({ name: PURCHASE_TOOL, arguments: args, ...(extra._meta === undefined ? {} : { _meta: extra._meta }) });
        if (payment !== null) {
          const payer = payerOf(payment);
          if (payer === undefined || payer !== check.buyer) {
            return fail("payer_mismatch", "the x402 payer must equal the buyer argument");
          }
          release = service.acquire(check.preview.previewId, check.buyer);
        }
        const normalized = { previewId: check.preview.previewId, buyer: check.buyer as string };
        const paid = await gateway.wrapperFor(check.priceAtomic);
        const result = await paid<typeof normalized>(async (a) => {
          const pending = await service.beginPurchase(a.previewId, a.buyer);
          return { content: [{ type: "text" as const, text: JSON.stringify({ status: "pending", resolutionId: pending.resolutionId }) }] };
        })(normalized, extra);

        if (payment === null || result.isError === true) {
          // PaymentRequired challenge, verification failure, or settlement failure: pass through.
          return result as CallToolResult;
        }
        // Settled. The onAfterSettlement hook already persisted the settlement and signed the
        // voucher against the real transaction hash; read the finalized record back.
        const unrecorded = () =>
          fail("settlement_unrecorded", "payment settled but the resolution is not yet recorded; call lemma_recover_resolution (do not pay again)");
        let final: Awaited<ReturnType<LemmaService["recover"]>>;
        try {
          final = await service.recover(check.preview.previewId, check.buyer);
        } catch (error) {
          logger.error("post-settlement read failed", { error: error instanceof Error ? error.message : String(error) });
          return { ...unrecorded(), ...(result._meta === undefined ? {} : { _meta: result._meta }) };
        }
        if ("found" in final) return { ...unrecorded(), ...(result._meta === undefined ? {} : { _meta: result._meta }) };
        const data = { resolution: final.resolution, voucher: final.voucher };
        return { ...ok(data), ...(result._meta === undefined ? {} : { _meta: result._meta }) };
      } catch (error) {
        return toFailure(error, logger, PURCHASE_TOOL);
      } finally {
        release?.();
      }
    },
  );

  server.registerTool(
    SUCCESS_FEE_TOOL,
    {
      description:
        "Paid via x402 (exact, USDC on Arbitrum Sepolia, amount = the preview's quote.successFeeAtomic). Pay after the acceptance tests pass, before submitting the passed receipt. Only the resolution's buyer can pay, once.",
      inputSchema: SuccessFeeInput,
    },
    async (args, extra) => {
      if (deps.gateway === undefined || deps.paidDisabledReason !== null) {
        return fail("paid_tools_disabled", deps.paidDisabledReason ?? "paid tools are disabled");
      }
      try {
        const check = await service.checkSuccessFee(args.resolutionId, args.buyer);
        const payment = extractPaymentFromMeta({ name: SUCCESS_FEE_TOOL, arguments: args, ...(extra._meta === undefined ? {} : { _meta: extra._meta }) });
        if (payment !== null) {
          const payer = payerOf(payment);
          if (payer === undefined || payer !== check.buyer) return fail("payer_mismatch", "the x402 payer must equal the buyer argument");
        }
        const normalized = { resolutionId: check.resolution.resolutionId as string, buyer: check.buyer as string };
        const paid = await deps.gateway.wrapperFor(check.amountAtomic, SUCCESS_FEE_TOOL);
        const result = await paid<typeof normalized>(async () => ({
          content: [{ type: "text" as const, text: JSON.stringify({ status: "pending", resolutionId: normalized.resolutionId }) }],
        }))(normalized, extra);
        if (payment === null || result.isError === true) return result as CallToolResult;
        const fee = await service.getSuccessFee(normalized.resolutionId);
        const meta = result._meta === undefined ? {} : { _meta: result._meta };
        if (fee === undefined) return { ...fail("settlement_unrecorded", "the fee settled but is not yet recorded; do not pay again"), ...meta };
        return { ...ok({ successFee: { resolutionId: fee.resolutionId, amountAtomic: fee.amountAtomic, txHash: fee.txHash } }), ...meta };
      } catch (error) {
        return toFailure(error, logger, SUCCESS_FEE_TOOL);
      }
    },
  );

  server.registerTool(
    "lemma_recover_resolution",
    {
      description: "Free. Returns the already-paid resolution and voucher for (previewId, buyer), or { found: false }. Never charges.",
      inputSchema: PurchaseInput,
    },
    async (args) => {
      try {
        const found = await service.recover(args.previewId, getAddress(args.buyer));
        return ok("found" in found ? found : { resolution: found.resolution, voucher: found.voucher });
      } catch (error) {
        return toFailure(error, logger, "lemma_recover_resolution");
      }
    },
  );

  server.registerTool(
    "lemma_submit_receipt",
    {
      description: "Free. Submit a buyer-signed (EIP-191 over adoptionReceiptDigest) Adoption Receipt for a settled resolution.",
      inputSchema: SignedAdoptionReceipt.shape,
    },
    async (args) => {
      try {
        return ok(await service.submitReceipt(args));
      } catch (error) {
        return toFailure(error, logger, "lemma_submit_receipt");
      }
    },
  );

  return server;
}
