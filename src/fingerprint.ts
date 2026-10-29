import { createHash } from "node:crypto";
import { isMainThread } from "node:worker_threads";

import { callWorkerSync } from "./bridge";
import { projectKey, toProjectRequest } from "./settings";
import type { PluginSettings } from "./types";

/**
 * Returns the settings with a fingerprint of the dependency graph's
 * violations added. Use it for `settings['dependency-cruiser']` in the ESLint
 * config, so that:
 * - `eslint --cache` re-lints every file whenever a violation anywhere appears
 *   or disappears (e.g. editing A breaks a cycle reported on B), and only then.
 * - `eslint --concurrency` threads find dependency-cruiser's disk cache warm,
 *   instead of all cruising from scratch.
 *
 * `cwd` must be ESLint's working directory, which is usually `process.cwd()`.
 */
export function withGraphFingerprint<Settings extends PluginSettings>(
  settings: Settings,
  { cwd = process.cwd() }: { cwd?: string } = {}
): Settings & { graph: string } {
  const request = toProjectRequest(cwd, settings);
  // ESLint starts its --concurrency threads with SHARE_ENV, after the main
  // thread has loaded the config. Passing the fingerprint on through the
  // environment gives every thread the same config hash without each one
  // cruising while loading its config.
  const envKey = `ESLINT_PLUGIN_DEPENDENCY_CRUISER_GRAPH_${createHash("sha1")
    .update(projectKey(request))
    .digest("hex")
    .slice(0, 12)}`;

  let graph = isMainThread ? undefined : process.env[envKey];
  if (!graph) {
    graph = callWorkerSync(
      { kind: "fingerprint", ...request },
      settings.timeout
    ).fingerprint;
    process.env[envKey] = graph;
  }
  return { ...settings, graph };
}
