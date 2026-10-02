export * from "./config.js";
export * from "./schema.js";
export * from "./tasks.js";
export * from "./prompts.js";
export * from "./matrix.js";
export * from "./cost.js";
export * from "./report.js";
export { parseArgs, main } from "./cli.js";

export const BENCHMARK_COMPONENT = {
  name: "@lemma/benchmark",
  status: "implemented",
  plannedRuns: 20,
} as const;
