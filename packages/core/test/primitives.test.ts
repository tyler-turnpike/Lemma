import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";

import {
  AmountError,
  canonicalJson,
  digest,
  evaluateSpend,
  formatUsdc,
  isPriceJustified,
  newResolutionId,
  parseAtomic,
  parseUsdc,
  redact,
  redactString,
  releaseIdFor,
  satisfiesRange,
  secretsFromEnv,
  validateBundlePath,
  type SpendRequest,
} from "../src/index.js";

describe("USDC amounts", () => {
  it("parses strict decimals into atomic units", () => {
    expect(parseUsdc("0.25")).toBe(250000n);
    expect(parseUsdc("1")).toBe(1000000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(parseUsdc("12.5")).toBe(12500000n);
    expect(parseUsdc("0")).toBe(0n);
  });
  it.each(["", "-1", "0.1234567", "1e3", "01", ".5", "1.", " 1", "1,5", "NaN", "Infinity", "0x10", "+1"])("rejects %j", (v) => {
    expect(() => parseUsdc(v)).toThrow(AmountError);
  });
  it("rejects non-strings", () => {
    expect(() => parseUsdc(0.25 as unknown as string)).toThrow(AmountError);
  });
  it("formats atomic units", () => {
    expect(formatUsdc(250000n)).toBe("0.25");
    expect(formatUsdc(120000n)).toBe("0.12");
    expect(formatUsdc(1000000n)).toBe("1");
    expect(formatUsdc(1n)).toBe("0.000001");
    expect(() => formatUsdc(-1n)).toThrow();
    for (const v of ["0.25", "3.000001", "100"]) expect(formatUsdc(parseUsdc(v))).toBe(v);
  });
  it("parses atomic strings strictly", () => {
    expect(parseAtomic("120000")).toBe(120000n);
    expect(() => parseAtomic("012")).toThrow();
    expect(() => parseAtomic("1.0")).toThrow();
  });
});

describe("canonical digests and identifiers", () => {
  it("is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
    expect(digest({ a: 1 })).toBe(keccak256(toBytes('{"a":1}')));
  });
  it("rejects values JSON cannot represent", () => {
    expect(() => digest({ a: 1n })).toThrow();
    expect(() => digest({ a: undefined })).toThrow();
    expect(() => digest({ a: Number.NaN })).toThrow();
    expect(() => digest(new Date())).toThrow();
  });
  it("derives release ids and random resolution ids", () => {
    expect(releaseIdFor("x402-mcp-server@1")).toBe(keccak256(toBytes("x402-mcp-server@1")));
    expect(() => releaseIdFor("../evil")).toThrow();
    const a = newResolutionId();
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(newResolutionId()).not.toBe(a);
  });
});

describe("semver ranges", () => {
  it("evaluates comparator conjunctions", () => {
    expect(satisfiesRange("1.29.0", ">=1.25.0 <2.0.0")).toBe(true);
    expect(satisfiesRange("2.0.0", ">=1.25.0 <2.0.0")).toBe(false);
    expect(satisfiesRange("1.30.0-beta.1", ">=1.0.0")).toBe(false);
    expect(satisfiesRange("1.0.0", "^1.0.0")).toBe(false);
  });
});

describe("spend policy", () => {
  const token = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";
  const payTo = "0x1111111111111111111111111111111111111111";
  const base: SpendRequest = {
    priceAtomic: 120000n,
    perResolutionCapAtomic: 250000n,
    dailyCapAtomic: 1000000n,
    spentTodayAtomic: 0n,
    network: "arbitrum-sepolia",
    token,
    expectedToken: token.toLowerCase(),
    recipient: payTo,
    expectedRecipient: payTo,
    expiresAt: new Date("2026-10-02T12:05:00Z"),
    now: new Date("2026-10-02T12:00:00Z"),
  };
  it("allows a compliant spend", () => {
    expect(evaluateSpend(base)).toEqual({ allowed: true, reasons: [] });
  });
  it.each<[string, Partial<SpendRequest>, string]>([
    ["per-resolution cap", { priceAtomic: 250001n }, "per-resolution"],
    ["daily cap", { spentTodayAtomic: 900000n }, "daily"],
    ["network", { network: "base-sepolia" }, "network"],
    ["token", { token: payTo }, "token"],
    ["recipient", { recipient: token }, "recipient"],
    ["expiry", { expiresAt: new Date("2026-10-02T11:59:00Z") }, "expired"],
    ["zero price", { priceAtomic: 0n }, "positive"],
    ["bad clock", { now: new Date("nope") }, "invalid"],
  ])("denies on %s", (_name, patch, fragment) => {
    const d = evaluateSpend({ ...base, ...patch });
    expect(d.allowed).toBe(false);
    expect(d.reasons.join(" ")).toContain(fragment);
  });
  it("fails closed on non-bigint amounts", () => {
    expect(evaluateSpend({ ...base, priceAtomic: 1 as unknown as bigint }).allowed).toBe(false);
  });
});

describe("pricing rule", () => {
  it("allows price <= 30% of saving", () => {
    expect(isPriceJustified(120000n, 400000n)).toBe(true);
    expect(isPriceJustified(120001n, 400000n)).toBe(false);
    expect(isPriceJustified(120000n, null)).toBe(false);
    expect(isPriceJustified(0n, 0n)).toBe(false);
  });
});

describe("bundle paths", () => {
  it.each(["src/index.ts", "src/lemma/x402-paywall.ts", "test/a.test.ts", "README.md"])("accepts %s", (p) => {
    expect(validateBundlePath(p)).toBeNull();
  });
  it.each([
    "/etc/passwd",
    "../outside.ts",
    "src/../../x",
    "./src/a.ts",
    "src//a.ts",
    "C:/x.ts",
    "src\\a.ts",
    ".env",
    "config/.env.local",
    ".git/config",
    "node_modules/x/index.js",
    "package.json",
    "package-lock.json",
    ".npmrc",
    ".github/workflows/ci.yml",
    "certs/server.pem",
    "~/x",
    "src/a b.ts",
    "",
  ])("rejects %j", (p) => {
    expect(validateBundlePath(p)).not.toBeNull();
  });
});

describe("redaction", () => {
  const key = `0x${"ab".repeat(32)}`;
  it("scrubs private keys, bearer tokens, and known env values", () => {
    const env = { BUYER_PRIVATE_KEY: key, DATABASE_URL: "postgres://u:supersecret@db/x", PORT: "3000" };
    const known = secretsFromEnv(env);
    expect(known).toHaveLength(2);
    const out = redactString(`key=${key} auth: Bearer abc.def.ghi123 db=postgres://u:supersecret@db/x port=3000`, { knownSecrets: known });
    expect(out).not.toContain("ab".repeat(32));
    expect(out).not.toContain("abc.def.ghi123");
    expect(out).not.toContain("supersecret");
    expect(out).toContain("port=3000");
  });
  it("keeps allowlisted public hashes", () => {
    const tx = `0x${"cd".repeat(32)}`;
    expect(redactString(`tx ${tx}`, { allowHex: [tx] })).toBe(`tx ${tx}`);
    expect(redactString(`tx ${tx}`)).toBe("tx 0x[REDACTED]");
  });
  it("deep-redacts objects, secret-named fields, and cycles", () => {
    const obj: Record<string, unknown> = { privateKey: "hunter2", nested: [{ msg: `oops ${key}` }], ok: 1 };
    obj["self"] = obj;
    const out = redact(obj) as Record<string, unknown>;
    expect(out["privateKey"]).toBe("[REDACTED]");
    expect(JSON.stringify((out["nested"] as unknown[])[0])).not.toContain("abab");
    expect(out["ok"]).toBe(1);
    expect(out["self"]).toBe(out);
    expect(obj["privateKey"]).toBe("hunter2");
  });
});
