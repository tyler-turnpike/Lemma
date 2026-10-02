/**
 * Pure validation of workspace-relative paths carried by patch bundles.
 * Returns null when the path is acceptable, otherwise a human-readable reason.
 */

const SEGMENT_RE = /^[A-Za-z0-9._@+-]+$/;
const MAX_PATH_LENGTH = 240;
const MAX_DEPTH = 16;

/** Directory segments that may never be written into. */
const PROTECTED_SEGMENTS = new Set([".git", "node_modules", ".ssh", ".gnupg", ".aws", ".github", ".husky", ".vscode", ".idea"]);

/** File basenames (lowercase) that may never be created or modified. */
const PROTECTED_BASENAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  ".gitmodules",
  ".gitattributes",
  ".gitignore",
  "id_rsa",
  "id_ed25519",
]);

const PROTECTED_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".keystore"];

export function validateBundlePath(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return "path must be a non-empty string";
  if (path.length > MAX_PATH_LENGTH) return "path is too long";
  if (path.includes("\0")) return "path contains NUL";
  if (path.includes("\\")) return "path must use forward slashes";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "absolute paths are not allowed";
  if (path.startsWith("~")) return "home-relative paths are not allowed";
  const segments = path.split("/");
  if (segments.length > MAX_DEPTH) return "path is too deep";
  for (const segment of segments) {
    if (segment === "") return "empty path segment";
    if (segment === "." || segment === "..") return "relative traversal segments are not allowed";
    if (!SEGMENT_RE.test(segment)) return `illegal characters in segment ${JSON.stringify(segment)}`;
    if (PROTECTED_SEGMENTS.has(segment.toLowerCase())) return `protected directory ${segment}`;
  }
  const base = (segments[segments.length - 1] ?? "").toLowerCase();
  if (base === ".env" || base.startsWith(".env.")) return "environment files are protected";
  if (PROTECTED_BASENAMES.has(base)) return `protected file ${base}`;
  if (PROTECTED_EXTENSIONS.some((ext) => base.endsWith(ext))) return "key material files are protected";
  return null;
}

export function isSafeBundlePath(path: string): boolean {
  return validateBundlePath(path) === null;
}
