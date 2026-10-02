# Benchmark Fixtures

The benchmark does not keep its own copies of repositories. Each task starts from a frozen catalog fixture (`packages/catalog/fixtures/<id>`), copied fresh into a temp workspace for every run. The harness records each copy's sha256 digest. The task definitions are in `src/tasks.ts`: fixture, task prompt, acceptance command, expected decision, and matching release. The network policy and time budget are in `src/config.ts`. Benchmark-owned acceptance tests for tasks that no release covers are in `../tasks/`.

Control and treatment runs must begin from identical copies. After the final benchmark freeze, fixture or prompt changes require a new experiment version. Do not overwrite the original run records.
