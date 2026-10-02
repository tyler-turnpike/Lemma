import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { decodeBase64, verifyBundleIntegrity } from "../bundle.js";
import { validateBundlePath } from "../paths.js";
import { PatchBundle, type PatchBundle as PatchBundleT } from "../schemas.js";

export type ApplyErrorCode = "invalid-bundle" | "unsafe-path" | "drift" | "conflict" | "io";

export class ApplyError extends Error {
  override name = "ApplyError";
  constructor(
    readonly code: ApplyErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}

export type FileChange = { path: string; op: "create" | "modify"; status: "pending" | "applied" | "unchanged" };
export type DependencyChange = { section: "dependencies" | "devDependencies"; name: string; version: string };

export type ApplyResult = {
  dryRun: boolean;
  changes: FileChange[];
  dependencyChanges: DependencyChange[];
  /** Files that were (or would be) written, including package.json for dependency additions. */
  filesChanged: number;
};

export type ApplyOptions = { dryRun?: boolean };

type Planned = { path: string; op: "create" | "modify"; target: string; content: Uint8Array; original: Buffer | null; mode: number | null };

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Safely applies a patch bundle to a workspace.
 * - Validates the bundle schema, content digests, and every path (confinement, protected files).
 * - Rejects symlinks anywhere on the path and non-regular targets.
 * - Detects base drift (modify) and pre-existing files (create) before any mutation.
 * - Merges dependency additions into package.json structurally, failing on version conflicts.
 * - Stages all content inside the workspace, then renames into place; rolls back on failure.
 * Defaults to dry run (preview) mode. Re-applying an already-applied bundle is a no-op.
 */
export async function applyBundle(workspaceDir: string, bundleInput: unknown, options: ApplyOptions = {}): Promise<ApplyResult> {
  const dryRun = options.dryRun ?? true;
  const problems = verifyBundleIntegrity(bundleInput);
  if (problems.length > 0) throw new ApplyError("invalid-bundle", `invalid bundle: ${problems.join("; ")}`);
  const bundle: PatchBundleT = PatchBundle.parse(bundleInput);

  let root: string;
  try {
    root = await realpath(workspaceDir);
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new ApplyError("io", "workspace directory is not accessible");
  }

  const planned: Planned[] = [];
  const changes: FileChange[] = [];
  for (const op of bundle.operations) {
    const target = await confinedTarget(root, op.path);
    const existing = await lstatOrNull(target);
    if (existing && !existing.isFile()) throw new ApplyError("unsafe-path", `${op.path} is not a regular file`, op.path);
    const content = decodeBase64(op.contentBase64);
    const current = existing ? await readFile(target) : null;
    const currentSha = current ? sha256(current) : null;

    if (currentSha !== null && currentSha === op.newSha256) {
      changes.push({ path: op.path, op: op.op, status: "unchanged" });
      continue;
    }
    if (op.op === "create" && current !== null) {
      throw new ApplyError("conflict", `${op.path} already exists with different content`, op.path);
    }
    if (op.op === "modify") {
      if (current === null) throw new ApplyError("drift", `${op.path} does not exist`, op.path);
      if (currentSha !== op.baseSha256) throw new ApplyError("drift", `${op.path} has drifted from the expected base`, op.path);
    }
    planned.push({ path: op.path, op: op.op, target, content, original: current, mode: existing ? existing.mode & 0o777 : null });
    changes.push({ path: op.path, op: op.op, status: dryRun ? "pending" : "applied" });
  }

  const dependencyChanges: DependencyChange[] = [];
  const additions = bundle.dependencyAdditions;
  const wantsDeps = Object.keys(additions.dependencies).length + Object.keys(additions.devDependencies).length > 0;
  if (wantsDeps) {
    const pkgPath = join(root, "package.json");
    const st = await lstatOrNull(pkgPath);
    if (!st || !st.isFile()) throw new ApplyError("conflict", "package.json is required for dependency additions", "package.json");
    const original = await readFile(pkgPath);
    let pkg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(original.toString("utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      pkg = parsed as Record<string, unknown>;
    } catch {
      throw new ApplyError("conflict", "package.json is not a JSON object", "package.json");
    }
    for (const section of ["dependencies", "devDependencies"] as const) {
      for (const [name, version] of Object.entries(additions[section]).sort(([a], [b]) => a.localeCompare(b))) {
        for (const s of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
          const existingSpec = sectionOf(pkg, s)[name];
          if (existingSpec !== undefined && existingSpec !== version) {
            throw new ApplyError("conflict", `package.json ${s}.${name} is ${String(existingSpec)}, bundle requires ${version}`, "package.json");
          }
        }
        if (sectionOf(pkg, section)[name] === undefined) {
          dependencyChanges.push({ section, name, version });
        }
      }
    }
    if (dependencyChanges.length > 0) {
      const next: Record<string, unknown> = { ...pkg };
      for (const section of ["dependencies", "devDependencies"] as const) {
        const merged: Record<string, unknown> = { ...sectionOf(pkg, section) };
        for (const c of dependencyChanges.filter((d) => d.section === section)) merged[c.name] = c.version;
        if (Object.keys(merged).length > 0) {
          next[section] = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
        }
      }
      const text = `${JSON.stringify(next, null, 2)}\n`;
      planned.push({
        path: "package.json",
        op: "modify",
        target: pkgPath,
        content: new TextEncoder().encode(text),
        original,
        mode: st.mode & 0o777,
      });
    }
  }

  const result: ApplyResult = { dryRun, changes, dependencyChanges, filesChanged: planned.length };
  if (dryRun || planned.length === 0) return result;

  const staging = join(root, `.lemma-staging-${randomBytes(8).toString("hex")}`);
  const applied: Planned[] = [];
  try {
    await mkdir(staging, { mode: 0o700 });
    const staged = new Map<Planned, string>();
    for (const [i, p] of planned.entries()) {
      const file = join(staging, String(i));
      await writeFile(file, p.content, { flag: "wx", mode: p.mode ?? 0o644 });
      if (p.mode !== null) await chmod(file, p.mode);
      staged.set(p, file);
    }
    for (const p of planned) {
      await mkdir(dirname(p.target), { recursive: true });
      // Re-check confinement after directory creation to defeat symlink races.
      await confinedTarget(root, relative(root, p.target).split(sep).join("/"), p.path === "package.json");
      await rename(staged.get(p) as string, p.target);
      applied.push(p);
    }
  } catch (error) {
    for (const p of applied.reverse()) {
      try {
        if (p.original === null) await unlink(p.target);
        else await writeFile(p.target, p.original);
      } catch {
        // best effort rollback; surfaced via the thrown error below
      }
    }
    if (error instanceof ApplyError) throw error;
    throw new ApplyError("io", `failed to apply bundle; rolled back ${applied.length} file(s)`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return result;
}

async function confinedTarget(root: string, relPath: string, allowProtected = false): Promise<string> {
  if (!allowProtected) {
    const problem = validateBundlePath(relPath);
    if (problem !== null) throw new ApplyError("unsafe-path", `${relPath}: ${problem}`, relPath);
  }
  const target = resolve(root, relPath);
  if (!target.startsWith(root + sep)) throw new ApplyError("unsafe-path", `${relPath} escapes the workspace`, relPath);
  let cursor = root;
  for (const segment of relPath.split("/")) {
    cursor = join(cursor, segment);
    const st = await lstatOrNull(cursor);
    if (st === null) break;
    if (st.isSymbolicLink()) throw new ApplyError("unsafe-path", `${relPath} traverses a symlink`, relPath);
    if (cursor !== target && !st.isDirectory()) throw new ApplyError("unsafe-path", `${relPath} has a non-directory parent`, relPath);
  }
  return target;
}

async function lstatOrNull(p: string) {
  try {
    return await lstat(p);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sectionOf(pkg: Record<string, unknown>, section: string): Record<string, unknown> {
  const value = pkg[section];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
