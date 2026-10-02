import type { Arm } from "./schema.js";
import type { BenchmarkTask } from "./tasks.js";

/**
 * The installed Lemma rule. Treatment runs receive it appended to the identical task prompt,
 * mirroring a project rule file a user would install next to the lemma-mcp bridge.
 */
export const LEMMA_RULE = [
  "Lemma rule (installed for this project):",
  "Before writing integration code, call `lemma_preview` (MCP server `lemma`) with the task kind that best matches the work",
  "(one of x402-paywall-mcp-server, x402-paying-mcp-client, x402-facilitator-hono). Previews are free.",
  "If the decision is `reuse` or `adapt` and local policy allows the purchase, call `lemma_buy_resolution` with the previewId,",
  "then `lemma_apply_resolution` with `apply: true`, then `lemma_verify_adoption`, and fix any remaining failures yourself.",
  "If the decision is `build` or `decline`, or local policy does not allow the purchase, do not buy: implement the change yourself.",
  "Never pay for a resolution more than once; a repeated `lemma_buy_resolution` call recovers instead of paying.",
].join("\n");

/** Shared prompt for both arms. Contains no paths outside the workspace, no credentials, and no hints about Lemma. */
export function basePrompt(task: BenchmarkTask): string {
  return [
    task.instructions,
    "",
    `Definition of done: \`${acceptanceCommand(task)}\` passes. The test file ${task.acceptance.testPath} is already in the`,
    "repository; read it to learn the required module paths and exports. Do not modify, move, skip or delete it.",
    "Dependencies are already resolvable from node_modules and shell commands have no network access, so do not run",
    "package installs. Record any new runtime dependency in package.json with an exact version. Keep the change minimal.",
    "When you are done, run the acceptance command once more and report the result in one short paragraph.",
  ].join("\n");
}

export function buildPrompt(task: BenchmarkTask, arm: Arm): string {
  const base = basePrompt(task);
  return arm === "treatment" ? `${base}\n\n${LEMMA_RULE}` : base;
}

export function acceptanceCommand(task: BenchmarkTask): string {
  return `npx --no vitest run ${task.acceptance.testPath}`;
}
