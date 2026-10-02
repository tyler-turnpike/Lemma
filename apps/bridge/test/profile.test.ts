import { mkdir, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { describe, expect, it } from "vitest";

import { PROFILE_READ_ALLOWLIST, buildWorkspaceProfile, safeReadFile, type ProfileFileReader } from "../src/profile.js";
import { buyerKey, copyFixture, tempDir } from "./helpers.js";

function recordingReader(): { reader: ProfileFileReader; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    reader: async (path, max) => {
      reads.push(path);
      return safeReadFile(path, max);
    },
  };
}

describe("workspace profile", () => {
  it("reads only allowlisted files and never source or secrets", async () => {
    const ws = await copyFixture("mcp-server-exact");
    await writeFile(join(ws, ".env"), `BUYER_PRIVATE_KEY=${buyerKey}\n`);
    await writeFile(join(ws, "src", "secret.ts"), `export const SECRET = "${buyerKey}";\n`);
    await writeFile(join(ws, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/zod": { version: "4.6.5" }, "node_modules/left-pad": { version: "1.0.0" } } }));
    const { reader, reads } = recordingReader();
    const profile = await buildWorkspaceProfile(ws, reader);

    expect(reads.length).toBeGreaterThan(0);
    for (const p of reads) expect(PROFILE_READ_ALLOWLIST as readonly string[]).toContain(basename(p));
    const json = JSON.stringify(profile);
    expect(json).not.toContain(buyerKey.slice(2));
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("left-pad");
    expect(json).not.toContain(ws);
    expect(profile.language).toBe("typescript");
    expect(profile.moduleSystem).toBe("esm");
    expect(profile.frameworks.mcpSdk).toBe(true);
    expect(profile.dependencies["@modelcontextprotocol/sdk"]).toBe("1.30.1");
    expect(profile.lockfile).toMatchObject({ present: true, kind: "package-lock.json" });
    expect(profile.lockfile.digest).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("refuses a symlinked package.json", async () => {
    const ws = await tempDir();
    const outside = await tempDir();
    await writeFile(join(outside, "package.json"), "{}");
    await symlink(join(outside, "package.json"), join(ws, "package.json"));
    await expect(buildWorkspaceProfile(ws)).rejects.toMatchObject({ code: "profile" });
  });

  it("detects non-Node repositories by marker presence without reading them", async () => {
    const ws = await copyFixture("python-service");
    const { reader, reads } = recordingReader();
    const profile = await buildWorkspaceProfile(ws, reader);
    expect(profile.language).toBe("python");
    expect(profile.dependencies).toEqual({});
    for (const p of reads) expect(PROFILE_READ_ALLOWLIST as readonly string[]).toContain(basename(p));
  });

  it("returns an empty 'other' profile for an empty directory", async () => {
    const ws = await tempDir();
    await mkdir(join(ws, "src"));
    const profile = await buildWorkspaceProfile(ws);
    expect(profile.language).toBe("other");
  });
});
