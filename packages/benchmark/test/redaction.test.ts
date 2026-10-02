import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { persist } from "../src/runner.js";
import { knownSecrets, parseEnvFile, scrubForPersistence } from "../src/secrets.js";
import { sampleRecord } from "./helpers.js";

const FAKE_OPENAI = "sk-proj-FAKEfakeFAKEfakeFAKEfake0123456789";
const FAKE_BUYER = `0x${"7e".repeat(32)}`;
const FAKE_RPC = "https://arb-sepolia.example/v2/abcdefghijklmnop";
const env = parseEnvFile(`# test env\nOPENAI_API_KEY="${FAKE_OPENAI}"\nBENCHMARK_BUYER_PRIVATE_KEY=${FAKE_BUYER}\nARBITRUM_SEPOLIA_RPC_URL=${FAKE_RPC} # comment\nLEMMA_API_URL=http://localhost:3000\n`);
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("secret handling in run records", () => {
  it("parses dotenv files without touching process.env", () => {
    expect(env.OPENAI_API_KEY).toBe(FAKE_OPENAI);
    expect(env.ARBITRUM_SEPOLIA_RPC_URL).toBe(FAKE_RPC);
    expect(process.env.BENCHMARK_BUYER_PRIVATE_KEY).toBeUndefined();
  });

  it("collects secret-named values only", () => {
    const secrets = knownSecrets(env);
    expect(secrets).toContain(FAKE_OPENAI);
    expect(secrets).toContain(FAKE_BUYER);
    expect(secrets).not.toContain("http://localhost:3000");
  });

  it("scrubs secrets from every persisted string and keeps public payment hashes", () => {
    const paymentHash = `0x${"ab".repeat(32)}`;
    const record = sampleRecord({ arm: "treatment" });
    record.finalMessage = `I found ${FAKE_OPENAI} and ${FAKE_BUYER} in the environment`;
    record.acceptance.outputTail = `Error: Bearer ${FAKE_OPENAI}\nrpc ${FAKE_RPC}`;
    record.error = { phase: "run", message: `failed with key ${FAKE_BUYER}` };
    record.lemma = { ...record.lemma!, purchased: true, priceAtomic: "120000", paymentHash };
    const secrets = knownSecrets(env, [FAKE_RPC]);
    const out = scrubForPersistence(record, secrets, [paymentHash]);
    const text = JSON.stringify(out);
    for (const s of [FAKE_OPENAI, FAKE_BUYER, FAKE_RPC]) expect(text).not.toContain(s);
    expect(text).toContain("[REDACTED]");
    expect(out.lemma?.paymentHash).toBe(paymentHash);
  });

  it("redacts unknown 32-byte hex values that could be private keys", () => {
    const record = sampleRecord({ finalMessage: `key 0x${"12".repeat(32)}` });
    expect(scrubForPersistence(record, []).finalMessage).toBe("key 0x[REDACTED]");
  });

  it("persist writes a schema-valid, scrubbed record file", () => {
    const outDir = mkdtempSync(join(tmpdir(), "lemma-bench-test-"));
    dirs.push(outDir);
    const record = sampleRecord({ finalMessage: `leaked ${FAKE_OPENAI}` });
    persist(record, { outDir }, knownSecrets(env));
    const written = readFileSync(join(outDir, `${record.runId}.json`), "utf8");
    expect(written).not.toContain(FAKE_OPENAI);
    expect(JSON.parse(written).finalMessage).toBe("leaked [REDACTED]");
  });
});
