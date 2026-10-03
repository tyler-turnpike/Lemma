import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { WorkspaceResolver, assertUsableWorkspace, workspaceFromRoots } from "../src/workspace.js";

describe("workspace resolution", () => {
  it("prefers LEMMA_WORKSPACE, then CLAUDE_PROJECT_DIR, then cwd", () => {
    expect(loadConfig({ LEMMA_WORKSPACE: "/a", CLAUDE_PROJECT_DIR: "/b" }, "/c").config).toMatchObject({ workspace: "/a", workspaceSource: "LEMMA_WORKSPACE" });
    expect(loadConfig({ CLAUDE_PROJECT_DIR: "/b" }, "/c").config).toMatchObject({ workspace: "/b", workspaceSource: "CLAUDE_PROJECT_DIR" });
    expect(loadConfig({ CLAUDE_PROJECT_DIR: " " }, "/c").config).toMatchObject({ workspace: "/c", workspaceSource: "cwd" });
  });

  it("uses LEMMA_HOME as the default state dir", () => {
    expect(loadConfig({ LEMMA_HOME: "/h/.lemma" }, "/c").config.stateDir).toBe("/h/.lemma");
    expect(loadConfig({ LEMMA_HOME: "/h/.lemma", LEMMA_STATE_DIR: "/s" }, "/c").config.stateDir).toBe("/s");
  });

  it("refuses the filesystem root, the home directory and unexpanded placeholders", () => {
    expect(() => assertUsableWorkspace("/", "/home/u")).toThrow(/filesystem root.*LEMMA_WORKSPACE/);
    expect(() => assertUsableWorkspace("/home/u/", "/home/u")).toThrow(/home directory.*LEMMA_WORKSPACE/);
    expect(() => assertUsableWorkspace("/x/${workspaceFolder}", "/home/u")).toThrow(/placeholder.*LEMMA_WORKSPACE/);
    expect(assertUsableWorkspace("/home/u/project", "/home/u")).toBe("/home/u/project");
    const { config } = loadConfig({ LEMMA_WORKSPACE: "${workspaceFolder}" }, "/c");
    expect(() => assertUsableWorkspace(config.workspace, "/home/u")).toThrow(/placeholder/);
  });

  it("refuses at tool time (not startup) when the resolved workspace is unusable", async () => {
    const resolver = new WorkspaceResolver(loadConfig({}, homedir()).config);
    await expect(resolver.get()).rejects.toThrow(/home directory/);
  });

  it("takes the first file:// client root when no env var names the workspace, asking once", async () => {
    let calls = 0;
    const roots = [{ uri: "https://example.com/x" }, { uri: pathToFileURL(join("/", "proj", "a b")).href }, { uri: "file:///other" }];
    const resolver = new WorkspaceResolver({ workspace: "/cwd", workspaceSource: "cwd" }, async () => {
      calls += 1;
      return roots;
    });
    expect(await resolver.get()).toBe("/proj/a b");
    expect(await resolver.get()).toBe("/proj/a b");
    expect(calls).toBe(1);
    expect(workspaceFromRoots([])).toBeNull();
  });

  it("ignores roots when an env var is set, and falls back to cwd when roots are unsupported or fail", async () => {
    const never = async () => {
      throw new Error("should not be asked");
    };
    expect(await new WorkspaceResolver({ workspace: "/env", workspaceSource: "LEMMA_WORKSPACE" }, never).get()).toBe("/env");
    expect(await new WorkspaceResolver({ workspace: "/env", workspaceSource: "CLAUDE_PROJECT_DIR" }, never).get()).toBe("/env");
    expect(await new WorkspaceResolver({ workspace: "/cwd", workspaceSource: "cwd" }, async () => null).get()).toBe("/cwd");
    expect(await new WorkspaceResolver({ workspace: "/cwd", workspaceSource: "cwd" }, never).get()).toBe("/cwd");
  });
});
