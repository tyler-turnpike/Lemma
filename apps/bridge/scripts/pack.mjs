// Builds the zero-dependency `lemma-mcp` npm package from src/cli.ts and packs it into
// apps/web/public/dl/, where the hosted dashboard serves it for
// `npx -y https://<host>/dl/lemma-mcp-<version>.tgz`.
//
// Bundles straight from TypeScript sources (never touches apps/bridge/dist); @lemma/core is
// resolved through its package exports (packages/core/dist), so build it first if it is stale.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const bridgeDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(bridgeDir, "../..");
const packDir = join(bridgeDir, "pack");
const outFile = join(packDir, "dist", "lemma-mcp.mjs");
const destDir = join(repoRoot, "apps/web/public/dl");
const { version } = JSON.parse(readFileSync(join(bridgeDir, "package.json"), "utf8"));

rmSync(join(packDir, "dist"), { recursive: true, force: true });
await build({
  entryPoints: [join(bridgeDir, "src/cli.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
  // src/cli.ts starts with its own shebang; esbuild keeps it, so the banner adds only the require shim.
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});

const pkg = {
  name: "lemma-mcp",
  version,
  description: "Lemma local MCP bridge: buy verified, warranted resolutions for coding agents (Arbitrum Sepolia testnet).",
  type: "module",
  bin: { "lemma-mcp": "dist/lemma-mcp.mjs" },
  files: ["dist"],
  engines: { node: ">=22" },
  license: "UNLICENSED",
};
writeFileSync(join(packDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

mkdirSync(destDir, { recursive: true });
// --workspaces=false: pack/ sits inside the monorepo but is not a workspace.
execFileSync("npm", ["pack", "--pack-destination", destDir, "--workspaces=false"], { cwd: packDir, stdio: ["ignore", "ignore", "inherit"] });

const tgz = join(destDir, `lemma-mcp-${version}.tgz`);
const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KiB`;
console.log(`bundle ${relative(repoRoot, outFile)} ${kb(outFile)}; package ${relative(repoRoot, tgz)} ${kb(tgz)}`);
