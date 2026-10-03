# Economics

## Target

Lemma's target is lower all-in cost-to-green for recurring software integration tasks.

All-in cost includes model usage, the Lemma price, chain cost, elapsed time, retries, and human intervention. A result is economically useful only if it reaches the same acceptance standard for less total cost.

## What is the asset

A Capability Release is a non-rival productive asset. Its value comes from reusable integration work, a declared compatibility domain, evidence, deterministic delivery, and the ability to generate future resolution revenue.

The raw open-source code is not made scarce and is not sold as property. A buyer purchases a Compatibility Resolution: the right and practical route to use one release for one declared task and repository profile under stated warranty terms.

Adoption Receipts are evidence. They are not tradable assets and do not mint rewards.

## Pricing rule

Each release has a registered USDC price, set from its measured saving. The resolver may offer a purchase only when:

`price <= 30 percent of measured expected raw model-cost saving`

The bridge separately enforces the user's per-resolution and daily limits. Prices use six-decimal atomic USDC integers, never floating-point currency.

If no frozen benchmark supports a release and profile, it may be previewed but not sold.

## Per-request quote

A token reduction is worth more on a pricier model, so each preview carries a quote scaled to the buyer:

```
expectedSaving(model) = measuredSaving × inputPrice(model) / inputPrice(benchmarkModel)
quote = clamp(roundUp(25% × expectedSaving(model), 0.0005 USDC), registeredPrice, 0.25 USDC)
```

- **Model.** The agent declares its model (`model` on the bridge's `lemma_preview`, or `LEMMA_AGENT_MODEL`). Unknown or missing models are priced as the benchmark model. The table is the frozen OpenAI list-price table the benchmark uses (`packages/core/src/pricing.ts`).
- **Share.** 25% of the expected saving, below the 30% rule, so the buyer keeps at least 75% of what Lemma saves. A quote that rounding would push over the rule falls back to the registered price.
- **Settlement.** The registered price is the floor and is paid up front; it is exactly what the warranty registry bonds and refunds. The rest of the quote is a **success fee**, paid over x402 (`lemma_pay_success_fee`) only after the pinned acceptance tests pass. A failed adoption owes no fee and gets the up-front price refunded from the bond, so nothing paid before success is ever outside the warranty. No contract change is needed: the registry still sees one fixed price per release.

Quotes for `x402-mcp-server@1.1.0` (measured saving 0.023063 USDC on gpt-5.6-luna, registered price 0.005):

| Declared model | Expected saving | Up front | On success | Total |
|---|---|---|---|---|
| gpt-5.6-luna (or unknown) | 0.023 | 0.005 | 0.001 | 0.006 |
| gpt-5.6-terra | 0.231 | 0.005 | 0.053 | 0.058 |
| gpt-5.5 | 0.577 | 0.005 | 0.1395 | 0.1445 |

**Trust.** The model is self-declared: declaring a cheaper one lowers the fee. That is acceptable because every quote, including the floor, passes the pricing rule; the rule protects the buyer. A modified bridge could also skip the fee. The server records the fee owed per resolution, and a passed receipt submitted without it marks the buyer delinquent: the server refuses that address any further sale.

## Warranty

x402 pays the provider immediately. The provider separately deposits USDC bond in the warranty registry.

After payment, a provider-signed voucher reserves bond equal to the resolution price. A separate evaluator can attest pass or failure during the 72-hour claim window. Failure creates buyer withdrawal credit. Pass or expiry releases the reservation.

This structure gives the provider an incentive to sell only profiles it expects to work. It also avoids building a custom success escrow inside the x402 flow.

## MVP business model

The hackathon build has one first-party provider and no fee split. The purpose is to validate whether agents use and benefit from paid resolutions.

After validation, external providers can publish bonded releases and receive resolution revenue. Lemma can retain a 10 percent service fee. That later market must preserve curation, outcome evidence, and no-match discipline.

## Explicit exclusions

- No token price represents compatibility value.
- No centrality score controls payouts.
- No fee is earned from free no-match decisions.
- No receipt count is presented as causal savings.
- No marketplace scale claim is made from one pilot or one release family.
