import { readdirSync } from "node:fs";
import { join, sep } from "node:path";

import type { CodexOptions, ThreadOptions } from "@openai/codex-sdk";

import { BRIDGE_LIMITS, FROZEN_AGENT } from "./config.js";
import { benchmarkRoot, bridgeEntrypoint, repoRoot } from "./paths.js";
import type { Arm } from "./schema.js";

export const PERMISSION_PROFILE = "lemma_bench";

export type CodexRunConfig = {
  arm: Arm;
  workspace: string;
  /** Per-run harness dir (CODEX_HOME, secrets file). Denied to the agent's sandbox. */
  harnessDir: string;
  codexHome: string;
  /** Empty per-run HOME for the agent's shells (readable, outside the harness dir). */
  agentHome: string;
  codexPath: string;
  apiKey: string;
  /** Treatment only. */
  bridge?: {
    apiUrl: string;
    stateDir: string;
    secretsFile: string;
    providerAddress: string;
    usdcAddress?: string;
    registryAddress?: string;
  };
};

/**
 * Paths the agent's shell may not read: every top-level entry of the repository except the
 * shared node_modules (catalog releases, server, bridge, .env, git history), plus the per-run
 * harness directory. Identical in shape for both arms.
 */
export function deniedReadPaths(harnessDir: string, root = repoRoot()): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    out.push(join(root, entry.name));
  }
  out.push(harnessDir);
  // bubblewrap cannot mount a deny rule inside an already-denied tree ("Can't mkdir parents"),
  // so nested entries are dropped: the enclosing deny already covers them.
  const unique = [...new Set(out)].sort();
  return unique.filter((p) => !unique.some((q) => q !== p && p.startsWith(q.endsWith(sep) ? q : q + sep)));
}

const tomlString = (s: string) => JSON.stringify(s);

/** TOML inline table for the permission profile: read everywhere, write workspace + tmp, deny harness/repo. */
export function filesystemPolicy(denied: readonly string[]): string {
  const entries = [`":root"="read"`, `":workspace_roots"="write"`, `":tmpdir"="write"`, ...denied.map((p) => `${tomlString(p)}="deny"`)];
  return `permissions.${PERMISSION_PROFILE}.filesystem={${entries.join(",")}}`;
}

/** CLI process environment: no inherited variables, no secrets (the SDK adds CODEX_API_KEY itself). */
export function codexProcessEnv(cfg: Pick<CodexRunConfig, "codexHome" | "agentHome">): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cfg.agentHome, CODEX_HOME: cfg.codexHome, LANG: "C.UTF-8" };
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  return env;
}

export function codexOptions(cfg: CodexRunConfig): CodexOptions {
  const config: NonNullable<CodexOptions["config"]> = {
    default_permissions: PERMISSION_PROFILE,
    // Shell commands inherit only core variables, never *KEY*/*SECRET*/*TOKEN* names.
    shell_environment_policy: { inherit: "core", ignore_default_excludes: false },
    // No project or user instructions/hooks beyond what we pass.
    project_doc_max_bytes: 0,
  };
  if (cfg.arm === "treatment") {
    if (cfg.bridge === undefined) throw new Error("treatment run without bridge configuration");
    const b = cfg.bridge;
    const env: Record<string, string> = {
      LEMMA_BENCH_BRIDGE_ENTRY: bridgeEntrypoint(),
      LEMMA_BENCH_SECRETS_FILE: b.secretsFile,
      LEMMA_API_URL: b.apiUrl,
      LEMMA_WORKSPACE: cfg.workspace,
      LEMMA_STATE_DIR: b.stateDir,
      LEMMA_PROVIDER_ADDRESS: b.providerAddress,
      LEMMA_MAX_USDC_PER_RESOLUTION: BRIDGE_LIMITS.maxUsdcPerResolution,
      LEMMA_DAILY_USDC_CAP: BRIDGE_LIMITS.dailyUsdcCap,
      PATH: process.env.PATH ?? "/usr/bin:/bin",
    };
    if (b.usdcAddress) env.USDC_ADDRESS = b.usdcAddress;
    if (b.registryAddress) env.RESOLUTION_WARRANTY_REGISTRY_ADDRESS = b.registryAddress;
    config.mcp_servers = {
      lemma: {
        command: process.execPath,
        args: [join(benchmarkRoot(), "bin", "bridge-launcher.mjs")],
        env,
        startup_timeout_sec: 30,
        tool_timeout_sec: 300,
        // approval_policy=never would otherwise reject every MCP call; spend limits are enforced in the bridge.
        enabled_tools: ["lemma_preview", "lemma_buy_resolution", "lemma_apply_resolution", "lemma_verify_adoption"],
        default_tools_approval_mode: "approve",
      },
    };
  }
  return {
    codexPathOverride: cfg.codexPath,
    apiKey: cfg.apiKey,
    env: codexProcessEnv(cfg),
    config,
    configOverrides: [filesystemPolicy(deniedReadPaths(cfg.harnessDir))],
  };
}

/** Thread options. sandboxMode is omitted on purpose: Codex rejects it alongside default_permissions. */
export function threadOptions(workspace: string): ThreadOptions {
  return {
    model: FROZEN_AGENT.model,
    modelReasoningEffort: FROZEN_AGENT.modelReasoningEffort,
    workingDirectory: workspace,
    skipGitRepoCheck: true,
    approvalPolicy: FROZEN_AGENT.approvalPolicy,
    webSearchMode: FROZEN_AGENT.webSearchMode,
  };
}

export function codexBinary(): string {
  return join(repoRoot(), "node_modules", ".bin", "codex");
}
