import { createSyncFn } from "synckit";
import type { ReportsRequest, ReportsResponse } from "./types";

const DEFAULT_TIMEOUT = 60_000;

type SyncGetReports = (request: ReportsRequest) => ReportsResponse;

// synckit keeps one worker per worker path, so there's only ever one
let worker: SyncGetReports | undefined;

/**
 * Gets a file's dependency-cruiser reports synchronously (ESLint rules can't be
 * async) by blocking on a worker thread. The worker is started on first use and
 * then reused for the lifetime of the process, keeping the dependency graph in
 * memory.
 */
export function getReportsSync(
  request: ReportsRequest,
  timeout = DEFAULT_TIMEOUT
): ReportsResponse {
  if (!worker) {
    // Always pass a timeout: if the worker dies, synckit would otherwise block
    // the ESLint thread forever.
    worker = createSyncFn<(request: ReportsRequest) => Promise<ReportsResponse>>(
      new URL("./worker.mjs", import.meta.url),
      { timeout }
    );
  }
  return worker(request);
}
