import {
  PROFILE_DEPENDENCY_ALLOWLIST,
  RepositoryProfile,
  type ProfileDependency,
  type RepositoryProfile as RepositoryProfileT,
} from "./schemas.js";
import { EXACT_VERSION_RE } from "./semver.js";
import { LEMMA_SCHEMA_VERSION } from "./constants.js";

type LockfileKind = RepositoryProfileT["lockfile"]["kind"];

export type ProfileOptions = {
  lockfileKind?: LockfileKind;
  /**
   * Exact versions resolved from a lockfile, keyed by package name. When absent,
   * only dependencies pinned to an exact version in package.json are recorded.
   */
  lockedVersions?: Record<string, string>;
};

const ALLOWLIST = new Set<string>(PROFILE_DEPENDENCY_ALLOWLIST);

/**
 * Builds the allowlisted RepositoryProfile from an untrusted parsed package.json.
 * Reads only reviewed fields; never paths, scripts bodies, or source.
 * Throws if the result does not validate.
 */
export function profileFromPackageJson(
  pkgJson: unknown,
  lockfileDigest: string | null,
  options: ProfileOptions = {},
): RepositoryProfileT {
  const pkg = isRecord(pkgJson) ? pkgJson : {};
  const deps = stringRecord(pkg["dependencies"]);
  const devDeps = stringRecord(pkg["devDependencies"]);
  const all: Record<string, string> = { ...devDeps, ...deps };
  const declared = new Set(Object.keys(all));

  const dependencies: Partial<Record<ProfileDependency, string>> = {};
  for (const name of [...declared].sort()) {
    if (!ALLOWLIST.has(name)) continue;
    const locked = options.lockedVersions?.[name];
    const spec = all[name] ?? "";
    const exact = locked !== undefined && EXACT_VERSION_RE.test(locked) ? locked : EXACT_VERSION_RE.test(spec) ? spec : null;
    if (exact !== null) dependencies[name as ProfileDependency] = exact;
  }

  const has = (n: string) => declared.has(n);
  const engines = isRecord(pkg["engines"]) ? pkg["engines"] : {};
  const nodeEngine = typeof engines["node"] === "string" && /^[0-9xX*.^~<>=| -]{1,64}$/.test(engines["node"]) ? engines["node"] : null;

  const scripts = stringRecord(pkg["scripts"]);
  const testScript = scripts["test"] ?? "";
  const testRunner = has("vitest")
    ? "vitest"
    : has("jest")
      ? "jest"
      : has("mocha")
        ? "mocha"
        : /\bnode\b.*--test\b/.test(testScript)
          ? "node-test"
          : testScript === ""
            ? "none"
            : "unknown";

  const lockfileKind = options.lockfileKind ?? null;
  const pmField = typeof pkg["packageManager"] === "string" ? pkg["packageManager"].split("@")[0] : undefined;
  const packageManager =
    pmField === "npm" || pmField === "pnpm" || pmField === "yarn" || pmField === "bun"
      ? pmField
      : lockfileKind === "package-lock.json"
        ? "npm"
        : lockfileKind === "pnpm-lock.yaml"
          ? "pnpm"
          : lockfileKind === "yarn.lock"
            ? "yarn"
            : lockfileKind === "bun.lock"
              ? "bun"
              : "npm";

  const profile = {
    schemaVersion: LEMMA_SCHEMA_VERSION,
    language: has("typescript") ? "typescript" : "javascript",
    packageManager,
    nodeEngine,
    lockfile: {
      present: lockfileDigest !== null,
      kind: lockfileDigest !== null ? (lockfileKind ?? "other") : null,
      digest: lockfileDigest,
    },
    dependencies,
    moduleSystem: pkg["type"] === "module" ? "esm" : "commonjs",
    frameworks: {
      mcpSdk: has("@modelcontextprotocol/sdk"),
      hono: has("hono"),
      express: has("express"),
      x402: [...declared].some((n) => n === "x402" || n.startsWith("@x402/")),
    },
    testRunner,
  };
  return RepositoryProfile.parse(profile);
}

/** Profile for a repository with no Node manifest (e.g. Python). Carries no dependency data. */
export function nonNodeProfile(
  language: Exclude<RepositoryProfileT["language"], "typescript" | "javascript">,
  packageManager: RepositoryProfileT["packageManager"] = "unknown",
): RepositoryProfileT {
  return RepositoryProfile.parse({
    schemaVersion: LEMMA_SCHEMA_VERSION,
    language,
    packageManager,
    nodeEngine: null,
    lockfile: { present: false, kind: null, digest: null },
    dependencies: {},
    moduleSystem: "unknown",
    frameworks: { mcpSdk: false, hono: false, express: false, x402: false },
    testRunner: "unknown",
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringRecord(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(v)) return out;
  for (const [k, val] of Object.entries(v)) if (typeof val === "string" && k.length <= 214) out[k] = val;
  return out;
}
