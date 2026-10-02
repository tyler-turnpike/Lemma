import { describe, expect, it } from "vitest";

import { planMatrix } from "../src/matrix.js";
import { TASKS } from "../src/tasks.js";

describe("frozen matrix", () => {
  const plan = planMatrix("lemma-bench-v1");

  it("has 20 runs: 3 matched tasks x 2 arms x 3 reps plus one no-match task per arm", () => {
    expect(plan).toHaveLength(20);
    const matched = TASKS.filter((t) => t.match === "matched");
    expect(matched).toHaveLength(3);
    for (const task of matched) {
      for (const arm of ["control", "treatment"] as const) {
        const reps = plan.filter((p) => p.taskId === task.id && p.arm === arm).map((p) => p.repetition).sort();
        expect(reps).toEqual([1, 2, 3]);
      }
    }
    const noMatch = plan.filter((p) => p.match === "no-match");
    expect(noMatch.map((p) => p.arm).sort()).toEqual(["control", "treatment"]);
    expect(noMatch.every((p) => p.fixtureId === "express-no-mcp")).toBe(true);
  });

  it("covers the exact server and client releases plus a boundary fixture", () => {
    expect(new Set(plan.filter((p) => p.match === "matched").map((p) => p.fixtureId))).toEqual(new Set(["mcp-server-exact", "mcp-client-exact", "mcp-server-boundary"]));
  });

  it("uses unique, stable run ids and balanced arm order", () => {
    expect(new Set(plan.map((p) => p.runId)).size).toBe(20);
    expect(plan.map((p) => p.matrixIndex)).toEqual([...Array(20).keys()]);
    expect(planMatrix("lemma-bench-v1")).toEqual(plan);
    const firstArm = (rep: number) => plan.find((p) => p.repetition === rep && p.match === "matched")!.arm;
    expect([firstArm(1), firstArm(2), firstArm(3)]).toEqual(["control", "treatment", "control"]);
  });
});
