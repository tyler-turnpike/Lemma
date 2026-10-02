import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { codexOptions, deniedReadPaths, filesystemPolicy, threadOptions, type CodexRunConfig } from "../src/codex-config.js";
import { FROZEN_AGENT } from "../src/config.js";
import { repoRoot } from "../src/paths.js";

const FAKE_API_KEY = "sk-proj-FAKEfakeFAKEfake0123456789abcdef";
const FAKE_BUYER = `0x${"5c".repeat(32)}`;
const tmp = mkdtempSync(join(tmpdir(), "lemma-bench-cfg-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function cfg(arm: "control" | "treatment"): CodexRunConfig {
  const harnessDir = join(tmp, "harness");
  mkdirSync(harnessDir, { recursive: true });
  const base: CodexRunConfig = { arm, workspace: join(tmp, "ws"), harnessDir, codexHome: join(harnessDir, "codex-home"), agentHome: join(tmp, "home"), codexPath: "/bin/false", apiKey: FAKE_API_KEY };
  if (arm === "treatment") {
    const secretsFile = join(harnessDir, "bridge.json");
    writeFileSync(secretsFile, JSON.stringify({ BUYER_PRIVATE_KEY: FAKE_BUYER }));
    base.bridge = { apiUrl: "https://lemma.example", stateDir: join(tmp, "state"), secretsFile, providerAddress: `0x${"22".repeat(20)}` };
  }
  return base;
}

describe("Codex configuration", () => {
  it("never puts credentials into CLI config overrides (which become argv) or the CLI env", () => {
    for (const arm of ["control", "treatment"] as const) {
      const opts = codexOptions(cfg(arm));
      const argvSide = JSON.stringify([opts.config, opts.configOverrides]);
      expect(argvSide).not.toContain(FAKE_API_KEY);
      expect(argvSide).not.toContain(FAKE_BUYER);
      expect(JSON.stringify(opts.env)).not.toContain(FAKE_API_KEY);
      expect(Object.keys(opts.env ?? {}).sort()).toEqual(["CODEX_HOME", "HOME", "LANG", "PATH", ...(process.env.TMPDIR ? ["TMPDIR"] : [])].sort());
      // The SDK passes apiKey to the CLI as CODEX_API_KEY in the child env, not argv.
      expect(opts.apiKey).toBe(FAKE_API_KEY);
    }
  });

  it("gives only the treatment arm the lemma bridge, with the key file path but not the key", () => {
    expect(codexOptions(cfg("control")).config?.mcp_servers).toBeUndefined();
    const servers = codexOptions(cfg("treatment")).config?.mcp_servers as Record<string, { env: Record<string, string>; default_tools_approval_mode: string; args: string[] }>;
    expect(Object.keys(servers)).toEqual(["lemma"]);
    const env = servers.lemma!.env;
    expect(env.LEMMA_API_URL).toBe("https://lemma.example");
    expect(env.LEMMA_BENCH_SECRETS_FILE).toMatch(/bridge\.json$/);
    expect(env.BUYER_PRIVATE_KEY).toBeUndefined();
    expect(servers.lemma!.default_tools_approval_mode).toBe("approve");
    expect(servers.lemma!.args[0]).toMatch(/bin\/bridge-launcher\.mjs$/);
  });

  it("uses the same sandbox, network and model settings for both arms", () => {
    const c = codexOptions(cfg("control"));
    const t = codexOptions(cfg("treatment"));
    expect(c.configOverrides).toEqual(t.configOverrides);
    const { mcp_servers: _ignored, ...tRest } = t.config ?? {};
    expect(c.config).toEqual(tRest);
    const thread = threadOptions("/w");
    expect(thread).toMatchObject({ model: FROZEN_AGENT.model, modelReasoningEffort: FROZEN_AGENT.modelReasoningEffort, approvalPolicy: "never", webSearchMode: FROZEN_AGENT.webSearchMode });
    expect(thread.sandboxMode).toBeUndefined();
    expect(thread.networkAccessEnabled).toBeUndefined();
  });

  it("denies reads of the repository (except node_modules) and the harness dir, without nested entries", () => {
    const denied = deniedReadPaths(join(repoRoot(), "packages", "benchmark", "runs", ".harness", "h-x"));
    expect(denied).toContain(join(repoRoot(), "packages"));
    expect(denied).toContain(join(repoRoot(), ".git"));
    expect(denied).not.toContain(join(repoRoot(), "node_modules"));
    expect(denied.some((p) => p.includes(".harness"))).toBe(false);
    const outside = deniedReadPaths("/var/tmp/harness-x");
    expect(outside).toContain("/var/tmp/harness-x");
    expect(filesystemPolicy(["/a b"])).toBe('permissions.lemma_bench.filesystem={":root"="read",":workspace_roots"="write",":tmpdir"="write","/a b"="deny"}');
  });
});
