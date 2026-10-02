import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CapabilityRelease,
  PatchBundle,
  bundleDigest,
  encodeBase64,
  keccakBytes,
  nonNodeProfile,
  profileFromPackageJson,
  releaseIdFor,
  sha256Hex,
  verifyBundleIntegrity,
  type CapabilityRelease as CapabilityReleaseT,
  type PatchBundle as PatchBundleT,
  type RepositoryProfile,
} from "@lemma/core";
import { z } from "zod";

type Hex = `0x${string}`;

export class CatalogError extends Error {
  override name = "CatalogError";
}

export type LoadedRelease = {
  manifest: CapabilityReleaseT;
  /** keccak256("name@version"), the onchain release identifier. */
  releaseId: Hex;
  bundle: PatchBundleT;
  payloadDigest: Hex;
};

export const FixtureMeta = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  release: z.string(),
  role: z.enum(["exact", "boundary", "near-match", "negative"]),
  task: z.string(),
  expectedDecision: z.enum(["reuse", "adapt", "build", "decline"]),
  acceptance: z.enum(["pass-after-patch", "none"]),
  nonNode: z.strictObject({ language: z.enum(["python", "go", "rust", "other"]), packageManager: z.enum(["pip", "poetry", "uv", "cargo", "go", "unknown"]) }).optional(),
});
export type FixtureMeta = z.infer<typeof FixtureMeta>;

const FixtureIndex = z.strictObject({ schemaVersion: z.literal("1"), note: z.string(), fixtures: z.array(FixtureMeta) });

export type Catalog = {
  readonly root: string;
  listReleases(): readonly CapabilityReleaseT[];
  /** Look up by "name@version" or by 0x release id. */
  getRelease(id: string): LoadedRelease | undefined;
  getBundle(id: string): PatchBundleT | undefined;
  listFixtures(): readonly FixtureMeta[];
  fixtureDir(fixtureId: string): string;
  fixtureProfile(fixtureId: string): RepositoryProfile;
};

/** packages/catalog, resolved from either src/ (tests) or dist/ (compiled). */
export function defaultCatalogRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Builds the deterministic PatchBundle for a release from its payload directory.
 * Fails closed on symlinks, missing files, or payload files the manifest does not declare.
 */
export function buildBundle(releaseDir: string, manifest: CapabilityReleaseT): PatchBundleT {
  const payloadDir = join(releaseDir, "payload");
  const onDisk = listRegularFiles(payloadDir);
  const declared = manifest.patch.operations.map((op) => op.path);
  const stray = onDisk.filter((p) => !declared.includes(p));
  if (stray.length > 0) throw new CatalogError(`${manifest.id}: undeclared payload files: ${stray.join(", ")}`);
  const operations = manifest.patch.operations.map((op) => {
    if (!onDisk.includes(op.path)) throw new CatalogError(`${manifest.id}: missing payload file ${op.path}`);
    const bytes = new Uint8Array(readFileSync(join(payloadDir, ...op.path.split("/"))));
    const common = { path: op.path, contentBase64: encodeBase64(bytes), newSha256: sha256Hex(bytes) };
    return op.op === "create" ? { op: "create" as const, baseSha256: null, ...common } : { op: "modify" as const, baseSha256: op.baseSha256, ...common };
  });
  const bundle = PatchBundle.parse({
    schemaVersion: "1",
    release: manifest.id,
    operations,
    dependencyAdditions: manifest.patch.dependencyAdditions,
  });
  const problems = verifyBundleIntegrity(bundle);
  if (problems.length > 0) throw new CatalogError(`${manifest.id}: ${problems.join("; ")}`);
  return bundle;
}

/** Reads and validates a manifest without checking its payload digest (used by the seal script). */
export function readManifest(releaseDir: string): CapabilityReleaseT {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(releaseDir, "manifest.json"), "utf8"));
  } catch (error) {
    throw new CatalogError(`${releaseDir}: unreadable manifest (${(error as Error).message})`);
  }
  const parsed = CapabilityRelease.safeParse(raw);
  if (!parsed.success) {
    throw new CatalogError(`${releaseDir}: invalid manifest: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}

/** Loads and validates every release and the fixture index. Throws on any inconsistency. */
export function loadCatalog(options: { root?: string } = {}): Catalog {
  const root = options.root ?? defaultCatalogRoot();
  const releasesDir = join(root, "releases");
  const byName = new Map<string, LoadedRelease>();
  const byId = new Map<string, LoadedRelease>();

  for (const entry of readdirSync(releasesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      if (entry.isSymbolicLink()) throw new CatalogError(`releases/${entry.name}: symlinks are not allowed`);
      continue;
    }
    const dir = join(releasesDir, entry.name);
    const manifest = readManifest(dir);
    if (manifest.id !== entry.name) throw new CatalogError(`releases/${entry.name}: directory must be named ${manifest.id}`);
    const bundle = buildBundle(dir, manifest);
    const payloadDigest = bundleDigest(bundle);
    if (payloadDigest !== manifest.payloadDigest) {
      throw new CatalogError(`${manifest.id}: payload digest mismatch (manifest ${manifest.payloadDigest}, computed ${payloadDigest})`);
    }
    const releaseId = releaseIdFor(manifest.id);
    if (byId.has(releaseId)) throw new CatalogError(`${manifest.id}: duplicate release`);
    const loaded: LoadedRelease = Object.freeze({ manifest, releaseId, bundle, payloadDigest });
    byName.set(manifest.id, loaded);
    byId.set(releaseId, loaded);
  }

  const fixturesRoot = join(root, "fixtures");
  const fixtureIndex = FixtureIndex.parse(JSON.parse(readFileSync(join(fixturesRoot, "index.json"), "utf8")));
  for (const f of fixtureIndex.fixtures) {
    if (!byName.has(f.release)) throw new CatalogError(`fixture ${f.id} references unknown release ${f.release}`);
    const st = lstatSync(join(fixturesRoot, f.id));
    if (!st.isDirectory()) throw new CatalogError(`fixture ${f.id} is not a directory`);
  }
  const releases = Object.freeze([...byName.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)).map((r) => r.manifest));

  const fixtureDir = (id: string) => {
    if (!fixtureIndex.fixtures.some((f) => f.id === id)) throw new CatalogError(`unknown fixture ${id}`);
    return join(fixturesRoot, id);
  };

  return {
    root,
    listReleases: () => releases,
    getRelease: (id) => byName.get(id) ?? byId.get(id.toLowerCase()),
    getBundle: (id) => (byName.get(id) ?? byId.get(id.toLowerCase()))?.bundle,
    listFixtures: () => fixtureIndex.fixtures,
    fixtureDir,
    fixtureProfile: (id) => {
      const meta = fixtureIndex.fixtures.find((f) => f.id === id);
      if (meta?.nonNode !== undefined) return nonNodeProfile(meta.nonNode.language, meta.nonNode.packageManager);
      return profileFromDirectory(fixtureDir(id));
    },
  };
}

/**
 * Builds a profile from a Node project directory by reading only package.json and,
 * when present, package-lock.json (digest only). Mirrors what the bridge sends.
 */
export function profileFromDirectory(dir: string): RepositoryProfile {
  const pkg: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  let lockDigest: Hex | null = null;
  try {
    lockDigest = keccakBytes(new Uint8Array(readFileSync(join(dir, "package-lock.json"))));
  } catch {
    lockDigest = null;
  }
  return profileFromPackageJson(pkg, lockDigest, lockDigest === null ? {} : { lockfileKind: "package-lock.json" });
}

/** sha256 (bare hex) of a file, used to pin modify-op bases to reviewed fixture content. */
export function fileSha256(path: string): string {
  return sha256Hex(new Uint8Array(readFileSync(path)));
}

function listRegularFiles(base: string): string[] {
  const out: string[] = [];
  const realBase = realpathSync(base);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new CatalogError(`symlink in payload: ${relative(realBase, full)}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(realBase, full).split(sep).join("/"));
      else throw new CatalogError(`unsupported file type in payload: ${relative(realBase, full)}`);
    }
  };
  walk(realBase);
  return out.sort();
}

export const CATALOG_COMPONENT = {
  name: "@lemma/catalog",
  status: "implemented",
} as const;
