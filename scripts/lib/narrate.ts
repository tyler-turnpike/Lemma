/** Narrated, recording-friendly console output. Every line is scrubbed of known secrets. */
import { Scrubber } from "./env.js";

export type Explorer = {
  tx(hash: string): string;
  address(addr: string): string;
};

export const ARBISCAN: Explorer = {
  tx: (h) => `https://sepolia.arbiscan.io/tx/${h}`,
  address: (a) => `https://sepolia.arbiscan.io/address/${a}`,
};

/** Fork transactions only exist locally; print the hash with a clear fork marker. */
export const FORK_EXPLORER: Explorer = {
  tx: (h) => `${h} (anvil fork, not on Arbiscan)`,
  address: (a) => `${a} (anvil fork)`,
};

const color = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export class Narrator {
  readonly txs: Array<{ label: string; hash: string }> = [];
  private failures = 0;

  constructor(
    readonly scrubber: Scrubber,
    readonly explorer: Explorer,
  ) {}

  private out(line: string): void {
    process.stdout.write(`${this.scrubber.scrub(line)}\n`);
  }

  banner(title: string): void {
    const bar = "=".repeat(Math.max(60, title.length + 4));
    this.out(`\n${paint("1", bar)}\n${paint("1", `  ${title}`)}\n${paint("1", bar)}`);
  }

  step(id: string, title: string): void {
    this.out(`\n${paint("1;36", `[${id}] ${title}`)}`);
  }

  say(text: string): void {
    for (const l of text.split("\n")) this.out(`    ${l}`);
  }

  kv(label: string, value: unknown): void {
    this.out(`    ${paint("2", `${label}:`.padEnd(24))} ${String(value)}`);
  }

  note(text: string): void {
    this.out(`    ${paint("33", `note: ${text}`)}`);
  }

  ok(text: string): void {
    this.out(`    ${paint("32", "ok")}  ${text}`);
  }

  tx(label: string, hash: string): void {
    this.txs.push({ label, hash });
    this.out(`    ${paint("35", "tx")}  ${label}: ${this.explorer.tx(hash)}`);
  }

  /** Assertion that is narrated when it holds and aborts the run when it does not. */
  check(cond: unknown, text: string): void {
    if (!cond) {
      this.failures += 1;
      throw new Error(`CHECK FAILED: ${text}`);
    }
    this.ok(text);
  }

  get failed(): number {
    return this.failures;
  }
}
