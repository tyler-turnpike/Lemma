import { prerender } from "react-dom/static";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";
import { connect } from "../src/content.js";
import {
  BRIDGE_TGZ,
  claudeCodeCommand,
  codexCommand,
  codexToml,
  cursorInstallUrl,
  genericJson,
  gooseInstallUrl,
  vscodeInstallUrl,
} from "../src/lib/connect.js";

const expected = { command: "npx", args: ["-y", BRIDGE_TGZ] };

describe("connect links", () => {
  it("points at the self-hosted bridge tarball", () => {
    expect(BRIDGE_TGZ).toBe("https://lemma-production-8383.up.railway.app/dl/lemma-mcp-0.1.0.tgz");
  });

  it("encodes a valid Cursor config", () => {
    const url = new URL(cursorInstallUrl);
    expect(url.origin + url.pathname).toBe("https://cursor.com/en/install-mcp");
    expect(url.searchParams.get("name")).toBe("lemma");
    const config = JSON.parse(atob(url.searchParams.get("config")!));
    expect(config).toMatchObject(expected);
    expect(config.env).toEqual({ LEMMA_WORKSPACE: "${workspaceFolder}" });
  });

  it("encodes a valid VS Code config", () => {
    const url = new URL(vscodeInstallUrl);
    expect(url.origin + url.pathname).toBe("https://vscode.dev/redirect/mcp/install");
    expect(url.searchParams.get("name")).toBe("lemma");
    expect(JSON.parse(url.searchParams.get("config")!)).toMatchObject({ type: "stdio", ...expected });
  });

  it("encodes a valid Goose deep link", () => {
    const url = new URL(gooseInstallUrl);
    expect(url.protocol).toBe("goose:");
    expect(url.searchParams.get("cmd")).toBe("npx");
    expect(url.searchParams.getAll("arg")).toEqual(["-y", BRIDGE_TGZ]);
    expect(url.searchParams.get("id")).toBe("lemma");
  });

  it("builds commands and JSON with no secrets", () => {
    expect(claudeCodeCommand).toBe(`claude mcp add -s local -t stdio lemma -- npx -y ${BRIDGE_TGZ}`);
    expect(codexCommand).toBe(`codex mcp add lemma -- npx -y ${BRIDGE_TGZ}`);
    expect(codexToml).toContain("startup_timeout_sec = 60");
    expect(JSON.parse(genericJson)).toEqual({ mcpServers: { lemma: expected } });
    for (const text of [cursorInstallUrl, vscodeInstallUrl, gooseInstallUrl, claudeCodeCommand, codexCommand, codexToml, genericJson]) {
      expect(decodeURIComponent(text)).not.toMatch(/PRIVATE_KEY|0x[0-9a-fA-F]{64}/);
    }
  });

  it("renders the page with the install action for the default agent", async () => {
    const { prelude } = await prerender(<App path="/connect" />);
    const html = await new Response(prelude).text();
    expect(html).toContain(connect.headline[0]);
    expect(html).toContain(connect.agents.cursor.button);
    expect(html).toContain('role="tablist"');
  });
});
