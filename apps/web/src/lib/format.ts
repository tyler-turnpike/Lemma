// Display formatting. Deterministic (fixed locale, UTC) so server and client renders match.

const ATOMIC_RE = /^(0|[1-9][0-9]{0,30})$/;
const USDC_SCALE = 1_000_000n;

/** "120000" -> "0.12 USDC". Money stays in bigint; never floats. */
export function formatUsdcAtomic(atomic: unknown): string {
  if (typeof atomic !== "string" || !ATOMIC_RE.test(atomic)) return "—";
  const value = BigInt(atomic);
  const whole = value / USDC_SCALE;
  const frac = (value % USDC_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toString()}${frac.length > 0 ? `.${frac.padEnd(2, "0")}` : ""} USDC`;
}

export function formatDuration(seconds: unknown): string {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "—";
  const hours = seconds / 3600;
  if (Number.isInteger(hours) && hours <= 96) return `${hours} hours`;
  const days = seconds / 86_400;
  return Number.isInteger(days) ? `${days} days` : `${Math.round(hours)} hours`;
}

const dateFormat = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

function toDate(value: unknown): Date | null {
  if (typeof value === "string" && value.length <= 64) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms);
  }
  return null;
}

export function formatDate(value: unknown): string {
  const date = toDate(value);
  return date === null ? "—" : dateFormat.format(date);
}

export function formatDateTime(value: unknown): string {
  const date = toDate(value);
  return date === null ? "—" : `${dateTimeFormat.format(date)} UTC`;
}

/** Unix seconds as a decimal string (EIP-712 uint64) -> ISO string, or null. */
export function unixSecondsToIso(value: unknown): string | null {
  if (typeof value !== "string" || !/^[0-9]{1,12}$/.test(value)) return null;
  return new Date(Number(value) * 1000).toISOString();
}

/** 0x1234…cdef */
export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}
