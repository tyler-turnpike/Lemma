import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

import { decodeBase64 } from "@lemma/core";
import type { Catalog } from "@lemma/catalog";

import { repoRoot } from "./paths.js";
import type { BenchmarkTask } from "./tasks.js";

/** Package directories never exposed to the agent: they contain Lemma's own releases (the answer key). */
const HIDDEN_PACKAGES = new Set(["@lemma"]);

/** Bytes of the task's acceptance test: the release's shipped test, or the benchmark-owned one. */
export function acceptanceTestBytes(task: BenchmarkTask, catalog: Catalog): Uint8Array {
  const src = task.acceptance;
  if (src.kind === "benchmark") return new Uint8Array(readFileSync(src.file));
  const bundle = catalog.getBundle(src.release);
  const op = bundle?.operations.find((o) => o.path === src.testPath);
  if (op === undefined) throw new Error(`${src.release} ships no ${src.testPath}`);
  return decodeBase64(op.contentBase64);
}

/**
 * Builds node_modules for a workspace as a real directory of per-package symlinks into the
 * repository's installed dependencies, omitting Lemma's own workspace packages. Symlinked packages
 * resolve their own dependencies from the repository root, as in the catalog e2e test.
 */
export function linkNodeModules(dir: string, sourceNodeModules = join(repoRoot(), "node_modules")): void {
  const target = join(dir, "node_modules");
  mkdirSync(target);
  for (const entry of readdirSync(sourceNodeModules, { withFileTypes: true })) {
    if (HIDDEN_PACKAGES.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".bin") continue;
    symlinkSync(join(sourceNodeModules, entry.name), join(target, entry.name), "dir");
  }
}

export type PreparedWorkspace = { dir: string; testBytes: Uint8Array; fixtureDigest: string };

/** Fresh temp copy of the fixture with the acceptance test installed. Identical for both arms. */
export function prepareWorkspace(task: BenchmarkTask, catalog: Catalog): PreparedWorkspace {
  const dir = mkdtempSync(join(tmpdir(), "lemma-bench-ws-"));
  cpSync(catalog.fixtureDir(task.fixtureId), dir, { recursive: true });
  const testBytes = acceptanceTestBytes(task, catalog);
  const testFile = join(dir, ...task.acceptance.testPath.split("/"));
  mkdirSync(dirname(testFile), { recursive: true });
  writeFileSync(testFile, testBytes);
  const fixtureDigest = digestSnapshot(snapshot(dir));
  linkNodeModules(dir);
  return { dir, testBytes, fixtureDigest };
}

export type Snapshot = Map<string, string>;

/** Top-level scratch dirs excluded from change counts: Codex sandbox TMPDIR (.tmp) and vitest caches (.vitest-tmp). */
const SCRATCH_DIRS = new Set([".tmp", ".vitest-tmp"]);

/** path -> sha256 of every regular file, excluding node_modules, .git and top-level scratch dirs. */
export function snapshot(dir: string): Snapshot {
  const out: Snapshot = new Map();
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (d === dir && SCRATCH_DIRS.has(entry.name)) continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.set(relative(dir, full).split(sep).join("/"), sha256File(full));
    }
  };
  walk(dir);
  return out;
}

export function digestSnapshot(snap: Snapshot): string {
  const lines = [...snap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, h]) => `${h}  ${p}`);
  return `sha256:${createHash("sha256").update(lines.join("\n")).digest("hex")}`;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): { added: string[]; modified: string[]; deleted: string[]; count: number } {
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const [p, h] of after) {
    const prev = before.get(p);
    if (prev === undefined) added.push(p);
    else if (prev !== h) modified.push(p);
  }
  for (const p of before.keys()) if (!after.has(p)) deleted.push(p);
  const sort = (a: string[]) => a.sort((x, y) => x.localeCompare(y));
  return { added: sort(added), modified: sort(modified), deleted: sort(deleted), count: added.length + modified.length + deleted.length };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
