// Install links and commands for the local Lemma bridge, one per coding agent. Everything is generated
// from one server definition so the Cursor, VS Code and Goose links can never drift from the commands.

export const BRIDGE_VERSION = "0.1.0";
export const SITE_ORIGIN = "https://lemma-production-8383.up.railway.app";
/** The bundled bridge, served by the Lemma server itself (no npm account or registry involved). */
export const BRIDGE_TGZ = `${SITE_ORIGIN}/dl/lemma-mcp-${BRIDGE_VERSION}.tgz`;
export const SERVER_NAME = "lemma";

/** The stdio server every agent launches. No keys: the bridge creates its own testnet wallet on first run. */
export const bridgeCommand = { command: "npx", args: ["-y", BRIDGE_TGZ] } as const;

/** Editors that expand `${workspaceFolder}` get it, so the bridge profiles the open project. */
const editorConfig = { ...bridgeCommand, env: { LEMMA_WORKSPACE: "${workspaceFolder}" } };

function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

export const cursorInstallUrl = `https://cursor.com/en/install-mcp?name=${SERVER_NAME}&config=${encodeURIComponent(base64(JSON.stringify(editorConfig)))}`;

export const vscodeInstallUrl = `https://vscode.dev/redirect/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(
  JSON.stringify({ type: "stdio", ...editorConfig }),
)}`;

export const gooseInstallUrl = `goose://extension?${new URLSearchParams([
  ["cmd", bridgeCommand.command],
  ...bridgeCommand.args.map((a) => ["arg", a] as [string, string]),
  ["id", SERVER_NAME],
  ["name", "Lemma"],
  ["description", "Verified integrations with a bonded warranty"],
]).toString()}`;

export const claudeCodeCommand = `claude mcp add -s local -t stdio ${SERVER_NAME} -- npx -y ${BRIDGE_TGZ}`;

export const codexCommand = `codex mcp add ${SERVER_NAME} -- npx -y ${BRIDGE_TGZ}`;

export const codexToml = `[mcp_servers.${SERVER_NAME}]
command = "npx"
args = ["-y", "${BRIDGE_TGZ}"]
startup_timeout_sec = 60`;

export const genericJson = JSON.stringify({ mcpServers: { [SERVER_NAME]: bridgeCommand } }, null, 2);
