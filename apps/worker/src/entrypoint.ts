import { main } from "./cli.ts";
import { createLegacyWorkerPorts } from "./legacy-adapter.ts";

// Real adapter composition over the legacy-schema database. Exits non-zero
// (via main) when the database is unreachable or a job fails.
try {
  const ports = await createLegacyWorkerPorts();
  const ok = await main(ports, process.argv.slice(2));
  process.exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(`Worker failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
