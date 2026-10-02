import { lstat, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";

import { PROFILE_DEPENDENCY_ALLOWLIST, keccakBytes, nonNodeProfile, profileFromPackageJson, type RepositoryProfile } from "@lemma/core";

import { BridgeError } from "./errors.js";

type LockfileKind = "package-lock.json" | "pnpm-lock.yaml" | "yarn.lock" | "bun.lock";

/** The only files whose bytes the profile builder ever reads. */
export const PROFILE_READ_ALLOWLIST = ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"] as const;
const LOCKFILES: readonly LockfileKind[] = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"];

/** Manifests whose presence (never content) marks a non-Node repository. */
const NON_NODE_MARKERS = [
  { file: "pyproject.toml", language: "python", packageManager: "unknown" },
  { file: "requirements.txt", language: "python", packageManager: "pip" },
  { file: "go.mod", language: "go", packageManager: "go" },
  { file: "Cargo.toml", language: "rust", packageManager: "cargo" },
] as const;

const MAX_BYTES: Record<string, number> = { "package.json": 1_000_000 };
const DEFAULT_MAX_BYTES = 50_000_000;

/** Reads one regular, non-symlink file by absolute path; null when it does not exist. */
export type ProfileFileReader = (absolutePath: string, maxBytes: number) => Promise<Uint8Array | null>;

export const safeReadFile: ProfileFileReader = async (absolutePath, maxBytes) => {
  let st;
  try {
    st = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new BridgeError("profile", "profile files must be regular files, not symlinks");
  if (st.size > maxBytes) throw new BridgeError("profile", "a profile file exceeds the size limit");
  return new Uint8Array(await readFile(absolutePath));
};

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the allowlisted RepositoryProfile for a workspace. Only the files in
 * PROFILE_READ_ALLOWLIST are read; lockfiles contribute a digest and (for npm)
 * exact versions of allowlisted dependency names. No source is read or sent.
 */
export async function buildWorkspaceProfile(workspace: string, reader: ProfileFileReader = safeReadFile): Promise<RepositoryProfile> {
  let root: string;
  try {
    root = await realpath(workspace);
  } catch {
    throw new BridgeError("profile", "workspace directory is not accessible");
  }
  const read = (name: (typeof PROFILE_READ_ALLOWLIST)[number]) => reader(join(root, name), MAX_BYTES[name] ?? DEFAULT_MAX_BYTES);

  const pkgBytes = await read("package.json");
  if (pkgBytes === null) {
    for (const marker of NON_NODE_MARKERS) {
      if (await exists(join(root, marker.file))) return nonNodeProfile(marker.language, marker.packageManager);
    }
    return nonNodeProfile("other");
  }
  let pkg: unknown;
  try {
    pkg = JSON.parse(new TextDecoder().decode(pkgBytes));
  } catch {
    throw new BridgeError("profile", "package.json is not valid JSON");
  }

  let lockfileKind: LockfileKind | null = null;
  let lockBytes: Uint8Array | null = null;
  for (const name of LOCKFILES) {
    lockBytes = await read(name);
    if (lockBytes !== null) {
      lockfileKind = name;
      break;
    }
  }
  const lockedVersions = lockfileKind === "package-lock.json" && lockBytes !== null ? npmLockedVersions(lockBytes) : undefined;
  return profileFromPackageJson(pkg, lockBytes === null ? null : keccakBytes(lockBytes), {
    ...(lockfileKind !== null ? { lockfileKind } : {}),
    ...(lockedVersions !== undefined ? { lockedVersions } : {}),
  });
}

/** Exact installed versions of allowlisted names from an npm v2/v3 lockfile. */
function npmLockedVersions(bytes: Uint8Array): Record<string, string> | undefined {
  try {
    const lock = JSON.parse(new TextDecoder().decode(bytes)) as { packages?: Record<string, { version?: unknown }> };
    const out: Record<string, string> = {};
    for (const name of PROFILE_DEPENDENCY_ALLOWLIST) {
      const v = lock.packages?.[`node_modules/${name}`]?.version;
      if (typeof v === "string") out[name] = v;
    }
    return out;
  } catch {
    return undefined;
  }
}
