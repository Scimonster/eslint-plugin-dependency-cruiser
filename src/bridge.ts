import { createSyncFn } from "synckit";
import type { WorkerRequest, WorkerResponses } from "./types";
import type { handle } from "./worker";

const DEFAULT_TIMEOUT = 60_000;

// synckit keeps one worker per worker path, so there's only ever one
let worker: ((request: WorkerRequest) => unknown) | undefined;

/**
 * Calls the dependency-cruiser worker synchronously (ESLint rules can't be
 * async) by blocking on its thread. The worker is started on first use and
 * then reused for the lifetime of the process, keeping dependency graphs in
 * memory.
 */
export function callWorkerSync<Request extends WorkerRequest>(
  request: Request,
  timeout = DEFAULT_TIMEOUT
): WorkerResponses[Request["kind"]] {
  if (!worker) {
    // Always pass a timeout: if the worker dies, synckit would otherwise block
    // the ESLint thread forever.
    worker = createSyncFn<typeof handle>(
      new URL("./worker.mjs", import.meta.url),
      { timeout }
    );
  }
  return worker(request) as WorkerResponses[Request["kind"]];
}
