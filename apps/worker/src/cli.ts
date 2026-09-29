import { createWorker, runScheduler, type StructuredLogger, type WorkerMetrics, type WorkerPorts, type RunSummary } from "./index.ts";

export const WORKER_HELP = `Usage: worker [--once] [--batch-size=N] [--interval-ms=N] [--max-ticks=N]

Options:
  --once             Run one worker tick, then exit
  --batch-size=N     Maximum items per job per tick (default: 50)
  --interval-ms=N    Delay between scheduled ticks (default: 60000)
  --max-ticks=N      Stop after N scheduled ticks (default: unbounded)
  --help, -h         Show this help

Environment:
  DATABASE_URL       Required PostgreSQL URL with host and database name

Heartbeat and health:
  Emits structured worker.heartbeat logs after each completed tick; metrics and
  logging can be injected by an adapter composition. SIGINT/SIGTERM wake a sleeping scheduler immediately. An active job is not
 cancellable: shutdown waits for the current tick to finish. There are no
 per-job timeouts or AbortSignal propagation in the current adapter contract.

Exit codes:
  0  Completed successfully (or shut down cleanly)
  1  A job or runtime failure
  2  Invalid configuration or unavailable real database adapters

The executable currently has no real payment/database adapter composition and
fails closed; no fulfillment is simulated or claimed.`;

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive safe integer`);
  return n;
}

export interface RuntimeConfiguration { once: boolean; batchSize: number; intervalMs: number; maxTicks?: number; databaseUrl: string }
export function parseRuntimeConfiguration(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): RuntimeConfiguration {
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") throw new Error(WORKER_HELP);
  }
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
    if (arg === "--help" || arg === "-h") continue;
    if (arg === "--once") {
      if (once) throw new Error("Duplicate argument: --once");
      once = true;
      continue;
    }
    const match = /^(--batch-size|--interval-ms|--max-ticks)=(.*)$/.exec(arg);
    if (!match) throw new Error(`Unknown argument: ${arg}`);
    if (values.has(match[1])) throw new Error(`Duplicate argument: ${match[1]}`);
    values.set(match[1], match[2]);
  }
  const batchSize = positiveInt(values.get("--batch-size"), 50, "batch size");
  const intervalMs = positiveInt(values.get("--interval-ms"), 60_000, "interval");
  const maxTicks = values.has("--max-ticks") ? positiveInt(values.get("--max-ticks"), 0, "max ticks") : undefined;
  return { once, batchSize, intervalMs, ...(maxTicks === undefined ? {} : { maxTicks }), databaseUrl };
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
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === WORKER_HELP) { console.log(WORKER_HELP); return 0; }
    console.error(`Worker configuration error: ${message}`);
    return 2;
  }
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
  let config: RuntimeConfiguration;
  try { config = parseRuntimeConfiguration(argv, env); }
  catch (error) { if (error instanceof Error && error.message === WORKER_HELP) return true; throw error; }
  const worker = createWorker(ports, { batchSize: config.batchSize, ...observability });
  if (config.once) { return hasJobErrors(await worker.runOnce()) ? false : true; }
  const controller = new AbortController();
  let shutdownSignal: "SIGINT" | "SIGTERM" | "completed" = "completed";
  let ticks = 0;
  let failed = false;
  const shutdown = () => controller.abort();
  const onInterrupt = () => { shutdownSignal = "SIGINT"; shutdown(); };
  const onTerminate = () => { shutdownSignal = "SIGTERM"; shutdown(); };
  signalHandlers.once("SIGINT", onInterrupt);
  signalHandlers.once("SIGTERM", onTerminate);
  try {
  await runScheduler(worker, {
      intervalMs: config.intervalMs, maxTicks: config.maxTicks, signal: controller.signal,
      onHeartbeat: (tick, result) => {
        ticks = tick;
        if (hasJobErrors(result)) failed = true;
        const fields = { tick, result, timestamp: new Date().toISOString() };
        (observability.logger ?? { info: (event: string, values: Record<string, unknown>) => console.info(JSON.stringify({ level: "info", event, ...values })), error: () => undefined }).info("worker.heartbeat", fields);
      },
    });
    const status = failed ? "failed" : "clean";
    const logger = observability.logger ?? { info: (event: string, values: Record<string, unknown>) => console.info(JSON.stringify({ level: "info", event, ...values })), error: () => undefined };
    logger.info("worker.shutdown", { status, signal: shutdownSignal, ticks });
    return !failed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (observability.logger ?? { info: () => undefined, error: (event: string, values: Record<string, unknown>) => console.error(JSON.stringify({ level: "error", event, ...values })) }).error("worker.shutdown", { status: "failed", signal: shutdownSignal, ticks, error: message });
    return false;
  } finally {
    signalHandlers.removeListener("SIGINT", onInterrupt);
    signalHandlers.removeListener("SIGTERM", onTerminate);
  }
}
