import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { BridgeConfig } from "./config.js";
import { BridgeError } from "./errors.js";

/** Lists the MCP client's roots; null when the client does not support roots. */
export type RootsLister = () => Promise<Array<{ uri: string }> | null>;

/**
 * Refuses workspaces that are almost certainly a misconfiguration: the filesystem root, the
 * home directory, or an unexpanded client placeholder such as `${workspaceFolder}`.
 */
export function assertUsableWorkspace(workspace: string, home: string = homedir()): string {
  const fix = "set LEMMA_WORKSPACE to the absolute path of the project in the MCP server config";
  if (workspace.includes("${")) throw new BridgeError("config", `workspace ${workspace} contains an unexpanded placeholder; ${fix}`);
  const abs = resolve(workspace);
  if (abs === resolve("/")) throw new BridgeError("config", `refusing to use the filesystem root as the workspace; ${fix}`);
  if (abs === resolve(home)) throw new BridgeError("config", `refusing to use the home directory as the workspace; ${fix}`);
  return abs;
}

/** First file:// root, as a local path; null when there is none. */
export function workspaceFromRoots(roots: ReadonlyArray<{ uri: string }>): string | null {
  for (const root of roots) {
    if (!root.uri.startsWith("file://")) continue;
    try {
      return fileURLToPath(root.uri);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Effective workspace: LEMMA_WORKSPACE, then CLAUDE_PROJECT_DIR, then the client's first
 * file:// root (asked once, on first use), then the process cwd. Validated on every call.
 */
export class WorkspaceResolver {
  private pending: Promise<string> | null = null;

  constructor(
    private readonly config: Pick<BridgeConfig, "workspace" | "workspaceSource">,
    private readonly listRoots: RootsLister | null = null,
    private readonly home: string = homedir(),
  ) {}

  async get(): Promise<string> {
    this.pending ??= this.resolve();
    return assertUsableWorkspace(await this.pending, this.home);
  }

  private async resolve(): Promise<string> {
    if (this.config.workspaceSource !== "cwd" || this.listRoots === null) return this.config.workspace;
    const roots = await this.listRoots().catch(() => null);
    return (roots === null ? null : workspaceFromRoots(roots)) ?? this.config.workspace;
  }
}
