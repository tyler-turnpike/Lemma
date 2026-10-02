import { spawn } from "node:child_process";

import { redactString, secretsFromEnv } from "../redact.js";
import { AcceptanceRecipe, type AcceptanceRecipe as AcceptanceRecipeT } from "../schemas.js";

export type AcceptanceStep = {
  argv: string[];
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  /** Redacted, truncated combined stdout/stderr tail. */
  output: string;
};

export type AcceptanceRun = { passed: boolean; steps: AcceptanceStep[]; durationMs: number };

export type AcceptanceOptions = {
  /** Source environment; only allowlisted names are forwarded. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  outputLimitBytes?: number;
};

/** Always forwarded so executables resolve; never secret-bearing. */
const BASE_ENV = ["PATH", "HOME", "TMPDIR", "LANG", "SystemRoot"] as const;

/**
 * Runs a validated acceptance recipe in `cwd`: each argv is spawned without a shell,
 * with an allowlisted environment, a shared deadline, and capped redacted output.
 * Stops at the first failing step.
 */
export async function runAcceptance(cwd: string, recipeInput: AcceptanceRecipeT, options: AcceptanceOptions = {}): Promise<AcceptanceRun> {
  const recipe = AcceptanceRecipe.parse(recipeInput);
  const source = options.env ?? process.env;
  const limit = options.outputLimitBytes ?? 64 * 1024;
  const env: NodeJS.ProcessEnv = { CI: "1", NO_COLOR: "1", FORCE_COLOR: "0", NODE_ENV: "test" };
  for (const name of [...BASE_ENV, ...recipe.env]) {
    const v = source[name];
    if (v !== undefined) env[name] = v;
  }
  const secrets = secretsFromEnv(source);
  const started = Date.now();
  const deadline = started + recipe.timeoutMs;
  const steps: AcceptanceStep[] = [];

  for (const argv of recipe.argv) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      steps.push({ argv, exitCode: null, signal: null, timedOut: true, durationMs: 0, output: "" });
      break;
    }
    const step = await runStep(cwd, argv, env, remaining, limit);
    step.output = redactString(step.output, { knownSecrets: secrets });
    steps.push(step);
    if (step.exitCode !== 0) break;
  }
  const passed = steps.length === recipe.argv.length && steps.every((s) => s.exitCode === 0 && !s.timedOut);
  return { passed, steps, durationMs: Date.now() - started };
}

function runStep(cwd: string, argv: string[], env: NodeJS.ProcessEnv, timeoutMs: number, limit: number): Promise<AcceptanceStep> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const [command, ...args] = argv as [string, ...string[]];
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    let output = "";
    let timedOut = false;
    const append = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > limit) output = output.slice(output.length - limit);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const kill = () => {
      try {
        if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // already exited
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const finish = (exitCode: number | null, signal: string | null) => {
      clearTimeout(timer);
      resolvePromise({ argv, exitCode: timedOut ? null : exitCode, signal, timedOut, durationMs: Date.now() - started, output });
    };
    child.on("error", (err) => {
      output += `\nspawn error: ${err.message}`;
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/** Best-effort extraction of vitest totals from runner output (for Adoption Receipts). */
export function summarizeVitestOutput(output: string): { passed: number; failed: number; skipped: number } {
  // The summary is the last line that starts with "Tests" followed by a count; failure output
  // also contains banners such as "Failed Tests 4" that must not be mistaken for it.
  const lines = [...output.replace(/\x1b\[[0-9;]*m/g, "").matchAll(/^\s*Tests\s+(\d[^\n]*)$/gm)];
  const line = lines.at(-1)?.[1] ?? "";
  const n = (label: string) => Number(new RegExp(`(\\d+) ${label}`).exec(line)?.[1] ?? 0);
  return { passed: n("passed"), failed: n("failed"), skipped: n("skipped") };
}
