import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadCatalog } from "@lemma/catalog";
import { afterAll, describe, expect, it } from "vitest";

import { parseArgs } from "../src/cli.js";
import { getTask, TASKS } from "../src/tasks.js";
import { diffSnapshots, prepareWorkspace, snapshot } from "../src/workspace.js";

const catalog = loadCatalog();
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("workspaces", () => {
  it("install the same acceptance test and fixture digest for every copy", () => {
    for (const task of TASKS) {
      const a = prepareWorkspace(task, catalog);
      const b = prepareWorkspace(task, catalog);
      dirs.push(a.dir, b.dir);
      expect(a.dir).not.toBe(b.dir);
      expect(a.fixtureDigest).toBe(b.fixtureDigest);
      expect(readFileSync(join(a.dir, task.acceptance.testPath))).toEqual(Buffer.from(a.testBytes));
    }
  });

  it("hide Lemma's own packages from node_modules but resolve everything else", () => {
    const ws = prepareWorkspace(getTask("mcp-client-paying-exact"), catalog);
    dirs.push(ws.dir);
    const entries = readdirSync(join(ws.dir, "node_modules"));
    expect(entries).not.toContain("@lemma");
    expect(entries).toEqual(expect.arrayContaining(["@x402", "@modelcontextprotocol", "vitest", ".bin"]));
    expect(existsSync(join(ws.dir, "node_modules", "@x402", "mcp", "package.json"))).toBe(true);
  });

  it("count added, modified and deleted files outside node_modules and the sandbox tmp dir", () => {
    const ws = prepareWorkspace(getTask("mcp-server-paywall-exact"), catalog);
    dirs.push(ws.dir);
    const before = snapshot(ws.dir);
    writeFileSync(join(ws.dir, "src", "server.ts"), "// changed\n");
    writeFileSync(join(ws.dir, "src", "new.ts"), "export {};\n");
    rmSync(join(ws.dir, "src", "index.ts"));
    rmSync(join(ws.dir, ".tmp"), { recursive: true, force: true });
    writeFileSync(join(ws.dir, "node_modules", ".cache-probe"), "x");
    mkdirSync(join(ws.dir, "vitest-cache", "ssr"), { recursive: true });
    writeFileSync(join(ws.dir, "vitest-cache", "ssr", "chunk.js"), "x");
    mkdirSync(join(ws.dir, "tmp-cache", "node-compile-cache"), { recursive: true });
    writeFileSync(join(ws.dir, "tmp-cache", "node-compile-cache", "v22"), "x");
    const diff = diffSnapshots(before, snapshot(ws.dir));
    expect(diff).toEqual({ added: ["src/new.ts"], modified: ["src/server.ts"], deleted: ["src/index.ts"], count: 3 });
  });
});

describe("cli arguments", () => {
  it("parses modes and options", () => {
    expect(parseArgs(["--plan"]).mode).toBe("plan");
    expect(parseArgs(["--run", "--confirm", "--experiment", "x1"])).toMatchObject({ mode: "run", confirm: true, experiment: "x1" });
    expect(parseArgs(["--report", "--no-publish"]).publish).toBe(false);
    expect(parseArgs([]).mode).toBeNull();
    expect(() => parseArgs(["--plan", "--smoke"])).toThrow();
    expect(parseArgs(["--smoke"]).arm).toBe("control");
    expect(parseArgs(["--smoke", "--arm", "treatment"]).arm).toBe("treatment");
    expect(parseArgs(["--smoke", "--arm=treatment"]).arm).toBe("treatment");
    expect(() => parseArgs(["--smoke", "--arm", "lemma"])).toThrow();
    expect(() => parseArgs(["--run", "--confirm", "--arm", "treatment"])).toThrow();
    expect(parseArgs(["--run", "--budget-usd", "2"]).budgetUsd).toBe(2);
    expect(parseArgs(["--run"]).budgetUsd).toBeNull();
    expect(() => parseArgs(["--run", "--budget-usd", "0"])).toThrow();
  });
});

describe("acceptance test vs the release actually sold", () => {
  // Regression: v2 installed the acceptance test from the task's 1.0.0 release, but the resolver
  // sold 1.1.0, whose copy of the same test file differed by a comment. applyBundle refused the
  // create with a conflict, so every treatment run fell back to writing the integration by hand.
  it("applies every version of the task's release line onto a prepared workspace without conflict", async () => {
    const { applyBundle } = await import("@lemma/core/node");
    for (const task of TASKS) {
      if (task.acceptance.kind !== "release") continue;
      const line = task.acceptance.release.split("@")[0];
      const versions = catalog.listReleases().filter((r) => r.name === line);
      expect(versions.length).toBeGreaterThan(0);
      for (const r of versions) {
        const ws = prepareWorkspace(task, catalog);
        dirs.push(ws.dir);
        const bundle = catalog.getBundle(r.id);
        expect(bundle, r.id).toBeDefined();
        await expect(applyBundle(ws.dir, bundle!, { dryRun: false }), `${task.id} -> ${r.id}`).resolves.toBeDefined();
      }
    }
  });
});
