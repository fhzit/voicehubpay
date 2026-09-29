export type TaskResult = { processed: number };

export interface FulfillmentTasks {
  /** Processes paid-order deliveries. Implementations must send one code per request. */
  process(limit: number): Promise<number>;
}
export interface AfdianTasks {
  /** Polls and routes orders through the same idempotent processor as notifications. */
  poll(limit: number): Promise<number>;
}
export interface ReservationTasks {
  /** Releases expired unpaid reservations only. */
  releaseExpiredUnpaid(limit: number): Promise<number>;
}
export interface WorkerPorts { fulfillment: FulfillmentTasks; afdian: AfdianTasks; reservations: ReservationTasks }

export interface StructuredLogger {
  info(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}
export interface JobMetric {
  job: "fulfillment" | "afdian" | "reservations";
  durationMs: number;
  succeeded: boolean;
  processed?: number;
}
export interface WorkerMetrics { observeJob(metric: JobMetric): void }
export interface WorkerOptions { batchSize?: number; logger?: StructuredLogger; metrics?: WorkerMetrics }

export type RunSummary = {
  fulfillment?: number; afdian?: number; reservations?: number;
  fulfillmentError?: string; afdianError?: string; reservationsError?: string;
};
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
const defaultLogger: StructuredLogger = {
  info: (event, fields) => console.info(JSON.stringify({ level: "info", event, ...fields })),
  error: (event, fields) => console.error(JSON.stringify({ level: "error", event, ...fields })),
};

export function createWorker(ports: WorkerPorts, options: WorkerOptions = {}) {
  const batchSize = options.batchSize ?? 50;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError("batchSize must be a positive safe integer");
  const logger = options.logger ?? defaultLogger;
  return {
    async runOnce(): Promise<RunSummary> {
      const result: RunSummary = {};
      const jobs = [
        ["fulfillment", () => ports.fulfillment.process(batchSize)],
        ["afdian", () => ports.afdian.poll(batchSize)],
        ["reservations", () => ports.reservations.releaseExpiredUnpaid(batchSize)],
      ] as const;
      for (const [name, run] of jobs) {
        const started = Date.now();
        try {
          const processed = await run();
          result[name] = processed;
          const metric: JobMetric = { job: name, durationMs: Date.now() - started, succeeded: true, processed };
          options.metrics?.observeJob(metric);
          logger.info("worker.job.result", { ...metric });
        } catch (error) {
          const message = errorMessage(error);
          result[`${name}Error` as "fulfillmentError" | "afdianError" | "reservationsError"] = message;
          const metric: JobMetric = { job: name, durationMs: Date.now() - started, succeeded: false };
          options.metrics?.observeJob(metric);
          logger.error("worker.job.result", { ...metric, error: message });
        }
      }
      logger.info("worker.tick.result", { result });
      return result;
    },
  };
}

export type AfdianTradeNumber = string & { readonly __afdianTradeNumber: unique symbol };
/** Keeps source bytes unchanged: no trimming, coercion, or normalization. */
export function assertAfdianTradeNumber(value: string): AfdianTradeNumber {
  if (value.length === 0) throw new TypeError("Afdian trade number must not be empty");
  return value as AfdianTradeNumber;
}
export interface ClaimedTask { id: string; state: "pending"; attempts: number }
export interface TaskLeaseStore {
  /** Atomically claims one eligible task and establishes a lease. */
  claimNext(leaseSeconds: number): Promise<ClaimedTask | null>;
  markSucceeded(id: string): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}
export interface SingleDelivery { deliverOne(task: ClaimedTask): Promise<void> }
/** Claims atomically; successful tasks are terminal and therefore never redelivered. */
export async function runClaimedTask(store: TaskLeaseStore, delivery: SingleDelivery, options: { leaseSeconds: number }): Promise<boolean> {
  if (!Number.isSafeInteger(options.leaseSeconds) || options.leaseSeconds < 1) throw new RangeError("leaseSeconds must be a positive safe integer");
  const task = await store.claimNext(options.leaseSeconds);
  if (!task) return false;
  try { await delivery.deliverOne(task); await store.markSucceeded(task.id); }
  catch (error) { await store.markFailed(task.id, errorMessage(error)); throw error; }
  return true;
}
export interface WorkerScheduler { runOnce(): Promise<RunSummary> }
export async function runScheduler(worker: WorkerScheduler, options: { intervalMs: number; signal?: AbortSignal; maxTicks?: number; onResult?: (result: RunSummary) => void; onHeartbeat?: (tick: number, result: RunSummary) => void }): Promise<void> {
  if (!Number.isSafeInteger(options.intervalMs) || options.intervalMs < 1) throw new RangeError("intervalMs must be a positive safe integer");
  if (options.maxTicks !== undefined && (!Number.isSafeInteger(options.maxTicks) || options.maxTicks < 1)) throw new RangeError("maxTicks must be a positive safe integer");
  let ticks = 0;
  while (!options.signal?.aborted && (options.maxTicks === undefined || ticks < options.maxTicks)) {
    const result = await worker.runOnce();
    ticks++;
    options.onResult?.(result);
    options.onHeartbeat?.(ticks, result);
    if (options.signal?.aborted || (options.maxTicks !== undefined && ticks >= options.maxTicks)) break;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const finish = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", finish); resolve(); };
      timer = setTimeout(finish, options.intervalMs);
      options.signal?.addEventListener("abort", finish, { once: true });
      if (options.signal?.aborted) finish();
    });
  }
}
