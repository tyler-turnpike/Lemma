/**
 * Minimal, deterministic semver handling for catalog constraints.
 * Ranges are a space-separated conjunction of comparators, e.g. ">=1.25.0 <2.0.0".
 * Caret, tilde, wildcards and "||" are intentionally not supported.
 */

export const EXACT_VERSION_RE = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z.-]+))?$/;
const COMPARATOR_RE = /^(>=|<=|>|<|=)((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?)$/;

export type ParsedVersion = { major: number; minor: number; patch: number; prerelease: string | null };

export function parseVersion(version: string): ParsedVersion | null {
  const m = EXACT_VERSION_RE.exec(version);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`invalid version comparison: ${a} vs ${b}`);
  for (const key of ["major", "minor", "patch"] as const) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : 1;
}

export function isValidRange(range: string): boolean {
  const parts = range.trim().split(/\s+/);
  return parts.length > 0 && parts.length <= 4 && parts.every((p) => COMPARATOR_RE.test(p));
}

/** True when `version` satisfies every comparator in `range`. Prereleases never satisfy. */
export function satisfiesRange(version: string, range: string): boolean {
  const parsed = parseVersion(version);
  if (!parsed || parsed.prerelease !== null || !isValidRange(range)) return false;
  return range
    .trim()
    .split(/\s+/)
    .every((part) => {
      const m = COMPARATOR_RE.exec(part);
      if (!m) return false;
      const cmp = compareVersions(version, m[2] as string);
      switch (m[1]) {
        case ">=":
          return cmp >= 0;
        case "<=":
          return cmp <= 0;
        case ">":
          return cmp > 0;
        case "<":
          return cmp < 0;
        default:
          return cmp === 0;
      }
    });
}
