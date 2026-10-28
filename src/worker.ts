import path from "node:path";

import { runAsWorker } from "synckit";
import { GraphCache } from "./graph-cache";
import type { ReportsRequest, ReportsResponse } from "./types";

// This module runs in a worker thread started by synckit. dependency-cruiser is
// ESM-only and uses top-level await, so it can't be `require`d from the ESLint
// thread; it's loaded lazily with `import()` (see ./project).
// Keep the top level of this file trivial: if it throws while loading, synckit
// can only notice via its timeout.

// One graph per project, so one editor server can lint several projects
const graphs = new Map<string, GraphCache>();

export async function getReports(
  request: ReportsRequest
): Promise<ReportsResponse> {
  const { cwd, configPath, knownViolationsPath, roots, cache, ttl, file } =
    request;
  const key = JSON.stringify([cwd, configPath, knownViolationsPath, roots, cache]);
  let graph = graphs.get(key);
  if (!graph) {
    graph = new GraphCache({ cwd, configPath, knownViolationsPath, roots, cache, ttl });
    graphs.set(key, graph);
  }

  const reports = await graph.get(path.relative(cwd, file));
  return {
    reports,
    ...(process.env.DEPCRUISE_ESLINT_DEBUG ? { cruises: graph.cruises } : {}),
  };
}

runAsWorker(getReports);
