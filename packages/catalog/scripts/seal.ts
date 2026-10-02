/**
 * Recomputes reviewed digests in every release manifest:
 * - modify-op baseSha256 from the release's exact fixture,
 * - payloadDigest from the deterministic bundle.
 * Run after editing payloads or fixtures: `npm run seal -w @lemma/catalog`. Review the diff.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bundleDigest } from "@lemma/core";

import { buildBundle, defaultCatalogRoot, fileSha256, readManifest } from "../src/index.js";

const root = defaultCatalogRoot();
const index = JSON.parse(readFileSync(join(root, "fixtures/index.json"), "utf8")) as { fixtures: Array<{ id: string; release: string; role: string }> };

for (const name of readdirSync(join(root, "releases"))) {
  const dir = join(root, "releases", name);
  const manifestPath = join(dir, "manifest.json");
  let raw: Record<string, any>;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    continue;
  }
  const exact = index.fixtures.find((f) => f.release === raw.id && f.role === "exact");
  if (!exact) throw new Error(`${raw.id}: no exact fixture`);
  for (const op of raw.patch.operations) {
    if (op.op === "modify") op.baseSha256 = fileSha256(join(root, "fixtures", exact.id, ...String(op.path).split("/")));
  }
  writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);
  const manifest = readManifest(dir);
  raw.payloadDigest = bundleDigest(buildBundle(dir, manifest));
  writeFileSync(manifestPath, `${JSON.stringify(raw, null, 2)}\n`);
  console.log(`${raw.id}: payloadDigest ${raw.payloadDigest}`);
}
