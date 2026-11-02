import { Worker } from "bullmq";
import type { RedisClient } from "../config/redis.js";
import { QUEUE_NAME, type SendJob } from "../types/index.js";
import type { Logger } from "../utils/logger.js";
import { createProcessor, type ProcessorDeps } from "./processor.js";

/** The BullMQ worker. One per process; the WhatsApp manager it sends through holds the single-worker lock. */
export function createMessageWorker(connection: RedisClient, deps: ProcessorDeps, opts: { concurrency: number; logger: Logger }): Worker<SendJob> {
  const process = createProcessor(deps);
  const worker = new Worker<SendJob>(QUEUE_NAME, (job, token) => process(job, token), {
    connection,
    concurrency: opts.concurrency,
    // A job whose worker died is handed to another worker after this long without a heartbeat.
    lockDuration: 120_000,
    stalledInterval: 60_000,
    maxStalledCount: 3,
  });
  worker.on("failed", (job, err) => {
    if (err.name === "DelayedError") return;
    opts.logger.warn({ jobId: job?.id, gymId: job?.data.gymId, err: err.message, attempts: job?.attemptsMade }, "send job failed");
  });
  worker.on("error", (err) => opts.logger.error({ err: err.message }, "worker error"));
  return worker;
}

// Run the worker with `npm run start:worker` (server.ts in RUN_MODE=worker). This file is not an entry point: importing
// server.js from here formed a top-level-await cycle (server.js -> worker.js -> this file) and the process exited.
