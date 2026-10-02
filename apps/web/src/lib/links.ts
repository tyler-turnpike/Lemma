// Outbound link allowlist. Every external href rendered from API data passes through here:
// only https links to the Arbitrum Sepolia explorer and GitHub are ever emitted.

export const ALLOWED_LINK_HOSTS = ["sepolia.arbiscan.io", "github.com"] as const;

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const GITHUB_REPO_RE = /^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/?$/;

/** Returns the normalised href when `value` is an https URL on an allowlisted host, otherwise null. */
export function safeExternalHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;
  if (!(ALLOWED_LINK_HOSTS as readonly string[]).includes(url.hostname)) return null;
  return url.href;
}

export function isTxHash(value: unknown): value is string {
  return typeof value === "string" && TX_HASH_RE.test(value);
}

export function isAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

export function arbiscanTx(hash: unknown): string | null {
  return isTxHash(hash) ? safeExternalHref(`https://sepolia.arbiscan.io/tx/${hash}`) : null;
}

export function arbiscanAddress(address: unknown): string | null {
  return isAddress(address) ? safeExternalHref(`https://sepolia.arbiscan.io/address/${address}`) : null;
}

export function arbiscanToken(address: unknown): string | null {
  return isAddress(address) ? safeExternalHref(`https://sepolia.arbiscan.io/token/${address}`) : null;
}

/** Link to an immutable upstream commit; both parts are validated before composing the URL. */
export function githubCommit(repoUrl: unknown, commit: unknown): string | null {
  const repo = safeExternalHref(repoUrl);
  if (repo === null || typeof commit !== "string" || !COMMIT_RE.test(commit)) return null;
  const url = new URL(repo);
  if (url.hostname !== "github.com" || !GITHUB_REPO_RE.test(url.pathname) || url.search !== "" || url.hash !== "") return null;
  return safeExternalHref(`https://github.com${url.pathname.replace(/\/$/, "")}/commit/${commit}`);
}

/** "owner/repo" label for a validated GitHub repository URL. */
export function githubRepoLabel(repoUrl: unknown): string | null {
  const repo = safeExternalHref(repoUrl);
  if (repo === null) return null;
  const url = new URL(repo);
  return url.hostname === "github.com" && GITHUB_REPO_RE.test(url.pathname) ? url.pathname.slice(1).replace(/\/$/, "") : null;
}
