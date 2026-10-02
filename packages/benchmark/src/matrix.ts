import { REPETITIONS } from "./config.js";
import type { Arm } from "./schema.js";
import { TASKS, type BenchmarkTask } from "./tasks.js";

export type PlannedRun = {
  matrixIndex: number;
  runId: string;
  taskId: string;
  match: BenchmarkTask["match"];
  fixtureId: string;
  arm: Arm;
  repetition: number;
};

/**
 * The frozen 20-run matrix: 3 matched tasks x 2 arms x 3 repetitions, plus the no-match task once per arm.
 * Order is deterministic and interleaved so that neither arm systematically runs earlier
 * (control first on odd repetitions, treatment first on even ones).
 */
export function planMatrix(experimentVersion: string, tasks: readonly BenchmarkTask[] = TASKS): PlannedRun[] {
  const out: PlannedRun[] = [];
  const push = (task: BenchmarkTask, arm: Arm, repetition: number) => {
    out.push({
      matrixIndex: out.length,
      runId: `${experimentVersion}-${task.id}-${arm}-r${repetition}`.toLowerCase(),
      taskId: task.id,
      match: task.match,
      fixtureId: task.fixtureId,
      arm,
      repetition,
    });
  };
  const matched = tasks.filter((t) => t.match === "matched");
  const noMatch = tasks.filter((t) => t.match === "no-match");
  for (let rep = 1; rep <= REPETITIONS; rep += 1) {
    const arms: Arm[] = rep % 2 === 1 ? ["control", "treatment"] : ["treatment", "control"];
    for (const task of matched) for (const arm of arms) push(task, arm, rep);
  }
  for (const task of noMatch) for (const arm of ["control", "treatment"] as const) push(task, arm, 1);
  return out;
}

export function formatPlan(plan: readonly PlannedRun[]): string {
  const rows = plan.map((p) => `${String(p.matrixIndex).padStart(2)}  ${p.arm.padEnd(9)}  r${p.repetition}  ${p.match.padEnd(8)}  ${p.taskId.padEnd(28)}  fixture=${p.fixtureId}`);
  const count = (pred: (p: PlannedRun) => boolean) => plan.filter(pred).length;
  return [
    ...rows,
    "",
    `total ${plan.length} runs: matched control ${count((p) => p.match === "matched" && p.arm === "control")}, matched treatment ${count((p) => p.match === "matched" && p.arm === "treatment")}, no-match control ${count((p) => p.match === "no-match" && p.arm === "control")}, no-match treatment ${count((p) => p.match === "no-match" && p.arm === "treatment")}`,
  ].join("\n");
}
