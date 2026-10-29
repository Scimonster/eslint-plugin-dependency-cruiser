import path from "node:path";

import { runAsWorker } from "synckit";
import { GraphCache } from "./graph-cache";
import { projectKey } from "./settings";
import type {
  ProjectRequest,
  WorkerRequest,
  WorkerResponses,
} from "./types";

// This module runs in a worker thread started by synckit. dependency-cruiser is
// ESM-only and uses top-level await, so it can't be `require`d from the ESLint
// thread; it's loaded lazily with `import()` (see ./project).
// Keep the top level of this file trivial: if it throws while loading, synckit
// can only notice via its timeout.

// One graph per project, so one editor server can lint several projects
const graphs = new Map<string, GraphCache>();

function graphFor(request: ProjectRequest) {
  const key = projectKey(request);
  let graph = graphs.get(key);
  if (!graph) {
    const { cwd, configPath, knownViolationsPath, roots, cache, ttl } = request;
    graph = new GraphCache({ cwd, configPath, knownViolationsPath, roots, cache, ttl });
    graphs.set(key, graph);
  }
  return graph;
}

export async function handle<Request extends WorkerRequest>(
  request: Request
): Promise<WorkerResponses[Request["kind"]]> {
  const graph = graphFor(request);
  const response =
    request.kind === "fingerprint"
      ? { fingerprint: await graph.fingerprint() }
      : { reports: await graph.get(path.relative(request.cwd, request.file)) };
  return {
    ...response,
    ...(process.env.DEPCRUISE_ESLINT_DEBUG ? { cruises: graph.cruises } : {}),
  } as WorkerResponses[Request["kind"]];
}

runAsWorker(handle);
