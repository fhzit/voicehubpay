import test from "node:test";
import assert from "node:assert/strict";
import { assertAfdianTradeNumber, createWorker, runScheduler, type WorkerPorts } from "./index.ts";
import { parseRuntimeConfiguration } from "./cli.ts";

test("preserves Afdian trade number exactly", () => {
  const tradeNo = " AFD-00/abc ";
  assert.equal(assertAfdianTradeNumber(tradeNo), tradeNo);
});

test("scheduler runs configured jobs without coupling notification and fulfillment", async () => {
  const calls: string[] = [];
  const ports: WorkerPorts = {
    fulfillment: { process: async (limit) => { calls.push(`fulfillment:${limit}`); return 1; } },
    afdian: { poll: async (limit) => { calls.push(`afdian:${limit}`); return 2; } },
    reservations: { releaseExpiredUnpaid: async (limit) => { calls.push(`release:${limit}`); return 3; } },
  };
  const worker = createWorker(ports, { batchSize: 7 });
  const result = await worker.runOnce();
  assert.deepEqual(calls, ["fulfillment:7", "afdian:7", "release:7"]);
  assert.deepEqual(result, { fulfillment: 1, afdian: 2, reservations: 3 });
});

test("isolates task failures and rejects invalid batch sizes", async () => {
  const ports: WorkerPorts = {
    fulfillment: { process: async () => { throw new Error("offline"); } },
    afdian: { poll: async () => 0 },
    reservations: { releaseExpiredUnpaid: async () => 0 },
  };
  const result = await createWorker(ports).runOnce();
  assert.equal(result.fulfillmentError, "offline");
  assert.equal(result.afdian, 0);
  assert.throws(() => createWorker(ports, { batchSize: 0 }), /batchSize/);
});

 test("claims tasks with lease and never re-delivers successful fulfillment", async () => {
  const { runClaimedTask } = await import("./index.ts");
  let delivered = 0;
  const store = {
    claimNext: async () => ({ id: "task-1", state: "pending" as const, attempts: 0 }),
    markSucceeded: async () => undefined,
    markFailed: async () => undefined,
  };
  await runClaimedTask(store, { deliverOne: async () => { delivered++; } }, { leaseSeconds: 60 });
  assert.equal(delivered, 1);
});

test("scheduler stops after abort during a tick and does not start another", async () => {
  const controller = new AbortController();
  let calls = 0;
  const tick = async () => { calls++; controller.abort(); return {}; };
  await runScheduler({ runOnce: tick }, { intervalMs: 10, signal: controller.signal });
  assert.equal(calls, 1);
});

test("scheduler propagates unexpected tick errors", async () => {
  await assert.rejects(runScheduler({ runOnce: async () => { throw new Error("fatal"); } }, { intervalMs: 10 }), /fatal/);
});

test("reports per-job metrics and structured result logs including failures", async () => {
  const events: unknown[] = [];
  const ports: WorkerPorts = {
    fulfillment: { process: async () => 4 },
    afdian: { poll: async () => { throw new Error("offline"); } },
    reservations: { releaseExpiredUnpaid: async () => 1 },
  };
  const worker = createWorker(ports, {
    logger: { info: (event, fields) => events.push({ event, fields }), error: (event, fields) => events.push({ event, fields }) },
    metrics: { observeJob: (metric) => events.push(metric) },
  });
  assert.deepEqual(await worker.runOnce(), { fulfillment: 4, afdianError: "offline", reservations: 1 });
  assert.equal(events.filter((item: any) => item.job).length, 3);
  assert.equal(events.filter((item: any) => item.event === "worker.job.result").length, 3);
});

test("scheduler logs and reports completed tick results", async () => {
  const results: unknown[] = [];
  await runScheduler({ runOnce: async () => ({ fulfillment: 2 }) }, {
    intervalMs: 1, signal: AbortSignal.abort(), onResult: (result) => results.push(result),
  });
  assert.deepEqual(results, []);
});

test("runtime configuration validates values and duplicate flags", () => {
  const env = { DATABASE_URL: "postgres://localhost/db" };
  assert.deepEqual(parseRuntimeConfiguration(["--batch-size=8", "--interval-ms=250", "--once"], env), { once: true, batchSize: 8, intervalMs: 250, databaseUrl: env.DATABASE_URL });
  assert.throws(() => parseRuntimeConfiguration(["--batch-size=0"], env), /positive/);
  assert.throws(() => parseRuntimeConfiguration(["--interval-ms=1", "--interval-ms=2"], env), /Duplicate/);
});
