import { loadCatalog } from "@lemma/catalog";
import { describe, expect, it } from "vitest";

import { LEMMA_RULE, acceptanceCommand, basePrompt, buildPrompt } from "../src/prompts.js";
import { recipeFor } from "../src/runner.js";
import { TASKS } from "../src/tasks.js";

describe("prompts", () => {
  it("are identical across arms except for the appended Lemma rule", () => {
    for (const task of TASKS) {
      const control = buildPrompt(task, "control");
      const treatment = buildPrompt(task, "treatment");
      expect(control).toBe(basePrompt(task));
      expect(treatment).toBe(`${control}\n\n${LEMMA_RULE}`);
      expect(treatment.replace(`\n\n${LEMMA_RULE}`, "")).toBe(control);
    }
  });

  it("mention Lemma tools only in the treatment rule", () => {
    for (const task of TASKS) {
      expect(buildPrompt(task, "control")).not.toMatch(/lemma_|Lemma rule|MCP server `lemma`/);
      expect(buildPrompt(task, "treatment")).toContain("lemma_preview");
    }
  });

  it("contain no absolute paths or credential-shaped values", () => {
    for (const task of TASKS) {
      const p = buildPrompt(task, "treatment");
      expect(p).not.toMatch(/\/home\/|\/tmp\/|0x[0-9a-fA-F]{64}|sk-|PRIVATE_KEY|API_KEY/);
    }
  });

  it("name the same acceptance command the harness runs", () => {
    const catalog = loadCatalog();
    for (const task of TASKS) {
      const recipe = recipeFor(task, catalog);
      expect(recipe.argv).toHaveLength(1);
      expect(recipe.argv[0]!.join(" ")).toBe(acceptanceCommand(task));
      expect(buildPrompt(task, "control")).toContain(acceptanceCommand(task));
    }
  });
});
