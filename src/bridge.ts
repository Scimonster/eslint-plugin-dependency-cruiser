import { createSyncFn } from "synckit";
import type { CruiseRequest, CruiseResponse } from "./types";

const DEFAULT_TIMEOUT = 60_000;

type SyncCruise = (request: CruiseRequest) => CruiseResponse;

const workers = new Map<number, SyncCruise>();
let lastResult:
  | { key: string; text: string; response: CruiseResponse }
  | undefined;

/**
 * Runs dependency-cruiser synchronously (ESLint rules can't be async) by
 * blocking on a worker thread. The worker is started on first use and then
 * reused for the lifetime of the process.
 */
export function cruiseFileSync(
  request: CruiseRequest,
  text: string,
  timeout = DEFAULT_TIMEOUT
): CruiseResponse {
  // The errors and warnings rules both run on the same file in one lint pass;
  // only cruise it once.
  const key = JSON.stringify(request);
  if (lastResult?.key === key && lastResult.text === text) {
    return lastResult.response;
  }

  let worker = workers.get(timeout);
  if (!worker) {
    // Always pass a timeout: if the worker dies, synckit would otherwise block
    // the ESLint thread forever.
    worker = createSyncFn<(request: CruiseRequest) => Promise<CruiseResponse>>(
      new URL("./worker.mjs", import.meta.url),
      { timeout }
    );
    workers.set(timeout, worker);
  }

  const response = worker(request);
  lastResult = { key, text, response };
  return response;
}
