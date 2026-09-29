import { runCli, main, parseRuntimeConfiguration, WORKER_HELP } from "./cli.ts";
import type { WorkerPorts } from "./index.ts";
import test from "node:test";
import assert from "node:assert/strict";

const ports: WorkerPorts = {
  fulfillment: { process: async () => 0 },
  afdian: { poll: async () => 0 },
  reservations: { releaseExpiredUnpaid: async () => 0 },
};
const env = { DATABASE_URL: "postgres://localhost/db" };

test("runtime config validates database URL and worker arguments", async () => {
  assert.equal(await runCli({ argv: [], env: {} }), 2);
  assert.throws(() => parseRuntimeConfiguration([], { DATABASE_URL: "not a url" }), /DATABASE_URL/);
  assert.throws(() => parseRuntimeConfiguration(["--wat"], env), /Unknown argument/);
});

test("CLI rejects missing adapters with configuration exit code", async () => {
  assert.equal(await runCli({ argv: ["--once"], env }), 2);
});

test("CLI help is successful and documents scheduling and exit codes", async () => {
  assert.equal(await runCli({ argv: ["--help"], env: {} }), 0);
  assert.match(WORKER_HELP, /--once/);
  assert.match(WORKER_HELP, /--interval-ms=N/);
  assert.match(WORKER_HELP, /Exit codes/);
  assert.equal(await main(ports, ["-h"], {}, undefined, env), true);
});

test("CLI returns nonzero when any job reports failure", async () => {
  const failing: WorkerPorts = { ...ports, afdian: { poll: async () => { throw new Error("offline"); } } };
  assert.equal(await runCli({ argv: ["--once"], env, ports: failing }), 1);
});

test("CLI succeeds for clean one-shot work with injected adapters", async () => {
  assert.equal(await runCli({ argv: ["--once"], env, ports }), 0);
});

test("runtime configuration validates values and duplicate flags", async () => {
  assert.deepEqual(parseRuntimeConfiguration(["--batch-size=8", "--interval-ms=250", "--once"], env), {
    once: true, batchSize: 8, intervalMs: 250, databaseUrl: env.DATABASE_URL,
  });
  assert.throws(() => parseRuntimeConfiguration(["--batch-size=0"], env), /positive/);
  assert.throws(() => parseRuntimeConfiguration(["--interval-ms=1", "--interval-ms=2"], env), /Duplicate/);
  assert.throws(() => parseRuntimeConfiguration([], { DATABASE_URL: "not a url" }), /DATABASE_URL/);
});

test("main registers SIGINT/SIGTERM and removes both handlers on shutdown", async () => {
  const handlers = new Map<string, (...args: any[]) => void>();
  const removed: string[] = [];
  const fakeSignals = {
    once: (signal: string, handler: (...args: any[]) => void) => { handlers.set(signal, handler); },
    removeListener: (signal: string) => { removed.push(signal); handlers.delete(signal); return fakeSignals; },
  } as any;
  const pending = main(ports, ["--interval-ms=5000"], {}, fakeSignals, env);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handlers.size, 2);
  handlers.get("SIGTERM")?.();
  assert.equal(await pending, true);
  assert.deepEqual(removed.sort(), ["SIGINT", "SIGTERM"]);
});
