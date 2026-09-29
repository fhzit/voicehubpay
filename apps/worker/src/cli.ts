import { createWorker, runScheduler, type StructuredLogger, type WorkerMetrics, type WorkerPorts, type RunSummary } from "./index.ts";

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive safe integer`);
  return n;
}

export interface RuntimeConfiguration { once: boolean; batchSize: number; intervalMs: number; databaseUrl: string }
export function parseRuntimeConfiguration(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): RuntimeConfiguration {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required; worker cannot start without a database connection");
  let parsedUrl: URL;
  try { parsedUrl = new URL(databaseUrl); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !parsedUrl.hostname || !parsedUrl.pathname.slice(1)) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL with host and database name");
  }
  const values = new Map<string, string>();
  let once = false;
  for (const arg of argv) {
    if (arg === "--once") {
      if (once) throw new Error("Duplicate argument: --once");
      once = true;
      continue;
    }
    const match = /^(--batch-size|--interval-ms)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    if (values.has(match[1])) throw new Error(`Duplicate argument: ${match[1]}`);
    values.set(match[1], match[2]);
  }
  const batchSize = positiveInt(values.get("--batch-size"), 50, "batch size");
  const intervalMs = positiveInt(values.get("--interval-ms"), 60_000, "interval");
  return { once, batchSize, intervalMs, databaseUrl };
}

function hasJobErrors(result: RunSummary): boolean {
  return Boolean(result.fulfillmentError || result.afdianError || result.reservationsError);
}

export interface CliOptions {
  argv?: readonly string[];
  env?: NodeJS.ProcessEnv;
  ports?: WorkerPorts;
  observability?: { logger?: StructuredLogger; metrics?: WorkerMetrics };
  signalHandlers?: Pick<NodeJS.Process, "once" | "removeListener">;
}

/** Returns 0 for clean work, 1 for job/startup failures, and 2 for configuration errors. */
export async function runCli(options: CliOptions = {}): Promise<number> {
  let config: RuntimeConfiguration;
  try { config = parseRuntimeConfiguration(options.argv ?? process.argv.slice(2), options.env ?? process.env); }
  catch (error) { console.error(`Worker configuration error: ${error instanceof Error ? error.message : String(error)}`); return 2; }
  if (!options.ports) {
    console.error("Worker configuration error: database adapters are unavailable; refusing to start without real DB integrations");
    return 2;
  }
  try {
    const result = await createWorker(options.ports, { batchSize: config.batchSize, ...options.observability }).runOnce();
    return hasJobErrors(result) ? 1 : 0;
  } catch (error) {
    console.error(`Worker failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** The executable shell requires injected adapters; it intentionally performs no service calls. */
export async function main(
  ports: WorkerPorts,
  argv = process.argv.slice(2),
  observability: { logger?: StructuredLogger; metrics?: WorkerMetrics } = {},
  signalHandlers: Pick<NodeJS.Process, "once" | "removeListener"> = process,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const config = parseRuntimeConfiguration(argv, env);
  const worker = createWorker(ports, { batchSize: config.batchSize, ...observability });
  if (config.once) { return hasJobErrors(await worker.runOnce()) ? false : true; }
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  signalHandlers.once("SIGINT", shutdown);
  signalHandlers.once("SIGTERM", shutdown);
  try {
    await runScheduler(worker, { intervalMs: config.intervalMs, signal: controller.signal });
    return true;
  } finally {
    signalHandlers.removeListener("SIGINT", shutdown);
    signalHandlers.removeListener("SIGTERM", shutdown);
  }
}
