/** USDC atomic-unit helpers. USDC uses 6 decimals. Never use floats for money. */

export const USDC_DECIMALS = 6;
const SCALE = 1_000_000n;
const DECIMAL_RE = /^(0|[1-9][0-9]{0,17})(?:\.([0-9]{1,6}))?$/;
const ATOMIC_RE = /^(0|[1-9][0-9]{0,30})$/;

export class AmountError extends Error {
  override name = "AmountError";
}

/** Parse a human decimal USDC string ("0.25") into atomic units (250000n). */
export function parseUsdc(value: string): bigint {
  if (typeof value !== "string") throw new AmountError("USDC amount must be a string");
  const match = DECIMAL_RE.exec(value);
  if (!match) throw new AmountError(`invalid USDC amount: ${JSON.stringify(value)}`);
  const whole = BigInt(match[1] ?? "0");
  const frac = (match[2] ?? "").padEnd(USDC_DECIMALS, "0");
  return whole * SCALE + BigInt(frac);
}

/** Format atomic units as a minimal decimal string (250000n -> "0.25"). */
export function formatUsdc(atomic: bigint): string {
  if (typeof atomic !== "bigint") throw new AmountError("atomic amount must be a bigint");
  if (atomic < 0n) throw new AmountError("negative amounts are not allowed");
  const whole = atomic / SCALE;
  const frac = (atomic % SCALE).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole.toString();
}

/** Parse an atomic-unit integer string ("120000") into a bigint, strictly. */
export function parseAtomic(value: string): bigint {
  if (typeof value !== "string" || !ATOMIC_RE.test(value)) {
    throw new AmountError(`invalid atomic amount: ${JSON.stringify(value)}`);
  }
  return BigInt(value);
}

export function isAtomicString(value: unknown): value is string {
  return typeof value === "string" && ATOMIC_RE.test(value);
}
