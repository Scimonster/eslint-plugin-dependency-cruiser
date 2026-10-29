import type { PluginSettings, ProjectRequest } from "./types";

const DEFAULT_ROOTS = ["src"];
const DEFAULT_TTL = 30_000;

/**
 * Turns ESLint settings into the worker's project fields. The rules and
 * `withGraphFingerprint` must agree on these, so they share one graph.
 */
export function toProjectRequest(
  cwd: string,
  settings: PluginSettings
): ProjectRequest {
  return {
    cwd,
    configPath: settings.config,
    knownViolationsPath: settings.knownViolations ?? settings.knownViolationsFile,
    roots: settings.roots ?? DEFAULT_ROOTS,
    cache: settings.cache ?? true,
    ttl: settings.ttl ?? DEFAULT_TTL,
  };
}

/** Identifies a project's graph; `ttl` doesn't change what's cruised */
export function projectKey(request: ProjectRequest) {
  const { cwd, configPath, knownViolationsPath, roots, cache } = request;
  return JSON.stringify([cwd, configPath, knownViolationsPath, roots, cache]);
}
