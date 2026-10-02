// CLI entrypoint: `npm run benchmark -- --plan | --smoke | --run --confirm | --report`.
import { main } from "./cli.js";

process.exitCode = await main();
