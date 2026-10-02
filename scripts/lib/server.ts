/**
 * Starts the real Lemma server entry (`node apps/server/dist/index.js`) as a child process, with
 * an explicit environment (nothing inherited except PATH/HOME), optionally on a throwaway
 * Postgres 16 cluster. Logs go to a file; the tail is printed (scrubbed) on failure.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { freePort } from "./anvil.js";
import { REPO_ROOT, childEnv } from "./env.js";

export const SERVER_ENTRY = join(REPO_ROOT, "apps", "server", "dist", "index.js");
export const BRIDGE_ENTRY = join(REPO_ROOT, "apps", "bridge", "dist", "index.js");

export function requireBuilt(): void {
  for (const f of [SERVER_ENTRY, BRIDGE_ENTRY]) {
    if (!existsSync(f)) throw new Error(`${f} is missing; run \`npm run build\` (or \`tsc -b\`) first`);
  }
}

export type Postgres = { url: string; stop(): void };

const PG_BIN = process.env.LEMMA_PG_BIN ?? "/usr/lib/postgresql/16/bin";

/** Throwaway local Postgres 16 cluster, or null when the binaries are unavailable. */
export async function startThrowawayPostgres(): Promise<Postgres | null> {
  if (!existsSync(join(PG_BIN, "initdb")) || !existsSync(join(PG_BIN, "pg_ctl"))) return null;
  const isRoot = process.getuid?.() === 0;
  const pgCmd = (bin: string, args: string[]) => {
    const [cmd, argv] = isRoot ? ["runuser", ["-u", "postgres", "--", join(PG_BIN, bin), ...args]] : [join(PG_BIN, bin), args];
    return spawnSync(cmd, argv as string[], { encoding: "utf8", timeout: 60_000 });
  };
  const dir = mkdtempSync(join(tmpdir(), "lemma-demo-pg-"));
  try {
    if (isRoot) execFileSync("chown", ["-R", "postgres:postgres", dir]);
    const data = join(dir, "data");
    const init = pgCmd("initdb", ["-D", data, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--no-sync"]);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
    const port = await freePort();
    const start = pgCmd("pg_ctl", ["-D", data, "-l", join(dir, "log"), "-w", "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`, "start"]);
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stderr}`);
    return {
      url: `postgres://postgres@127.0.0.1:${port}/postgres`,
      stop: () => {
        pgCmd("pg_ctl", ["-D", data, "-m", "immediate", "stop"]);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    process.stderr.write(`postgres unavailable (${(error as Error).message.slice(0, 200)}); falling back to in-memory storage\n`);
    return null;
  }
}

export type RunningServer = { url: string; logFile: string; child: ChildProcess; stop(): Promise<void>; tail(n?: number): string };

/** `env` is the complete server environment (PATH/HOME are added). */
export async function startServer(env: Record<string, string>, logDir: string): Promise<RunningServer> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const logFile = join(logDir, "server.log");
  const out = createWriteStream(logFile, { flags: "a" });
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: childEnv({ ...env, PORT: String(port), PUBLIC_BASE_URL: url }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  const tail = (n = 30) => {
    try {
      return readFileSync(logFile, "utf8").split("\n").slice(-n).join("\n");
    } catch {
      return "";
    }
  };
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}:\n${tail()}`);
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) break;
    } catch {
      /* not ready */
    }
    if (i === 119) throw new Error(`server did not become healthy:\n${tail()}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    url,
    logFile,
    child,
    tail,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 12_000).unref();
      }),
  };
}

/** Tail of a log file, or "" when it does not exist. */
export function fileTail(path: string, lines = 40): string {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/**
 * Printed when a demo fails: whether the server process is still alive, and the tails of the
 * server and bridge logs (scrubbed). The scratch directory is kept so the full logs survive.
 */
export function failureReport(workDir: string, server: RunningServer | null, scrub: (s: string) => string): string {
  const parts: string[] = [];
  if (server !== null) {
    const alive = server.child.exitCode === null && server.child.signalCode === null;
    parts.push(`server process: ${alive ? "running" : `EXITED (code ${server.child.exitCode}, signal ${server.child.signalCode})`}`);
    parts.push(`--- server log tail (${server.logFile}) ---\n${fileTail(server.logFile)}`);
  }
  const bridgeLog = join(workDir, "logs", "bridge.log");
  parts.push(`--- bridge log tail (${bridgeLog}) ---\n${fileTail(bridgeLog, 30)}`);
  parts.push(`kept scratch directory ${workDir}`);
  return scrub(parts.join("\n"));
}
