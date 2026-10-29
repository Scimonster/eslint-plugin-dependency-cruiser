import type { SeverityType } from "dependency-cruiser";

/**
 * Settings read from ESLint's shared `settings['dependency-cruiser']`.
 */
export interface PluginSettings {
  /** Path to the dependency-cruiser config, relative to ESLint's cwd */
  config?: string;
  /** Path to the dependency-cruiser baseline file, relative to ESLint's cwd */
  knownViolations?: string;
  /** @deprecated alias of `knownViolations`, kept for 0.1.x compatibility */
  knownViolationsFile?: string;
  /** Folders to cruise, relative to ESLint's cwd. Defaults to `["src"]` */
  roots?: string[];
  /** Whether the first cruise may use dependency-cruiser's disk cache. Defaults to true */
  cache?: boolean;
  /** How old (ms) the dependency graph may get before it's refreshed. Defaults to 30s */
  ttl?: number;
  /** How long (ms) to wait for the dependency-cruiser worker before failing */
  timeout?: number;
  /**
   * Fingerprint of the dependency graph's violations, set by
   * `withGraphFingerprint`. Not read by the rules: it only exists so that
   * ESLint's `--cache` sees a config change whenever the violations change.
   */
  graph?: string;
}

/**
 * Identifies a project (and how to cruise it) in the worker. Only plain data,
 * since it crosses a thread boundary via structured clone.
 */
export interface ProjectRequest {
  cwd: string;
  configPath?: string;
  knownViolationsPath?: string;
  roots: string[];
  cache: boolean;
  ttl: number;
}

export interface ReportsRequest extends ProjectRequest {
  kind: "reports";
  /** Absolute path of the linted file */
  file: string;
}

export interface FingerprintRequest extends ProjectRequest {
  kind: "fingerprint";
}

export type WorkerRequest = ReportsRequest | FingerprintRequest;

/**
 * A violation found by dependency-cruiser, and where the rule should report it:
 * - `import`: on the import of `specifier` (each edge of a cycle is one of these)
 * - `file`: on the file as a whole (orphans, reachability)
 */
export interface Report {
  name: string;
  severity: SeverityType;
  comment?: string;
  at: "import" | "file";
  /** The import source as written in the file, e.g. "./bar" */
  specifier?: string;
  /** For circular dependencies: the files in the cycle, starting at this one */
  cycle?: string[];
}

interface DebugInfo {
  /** Number of full cruises this project has done; only set for debugging */
  cruises?: number;
}

export interface ReportsResponse extends DebugInfo {
  reports: Report[];
}

export interface FingerprintResponse extends DebugInfo {
  fingerprint: string;
}

export interface WorkerResponses {
  reports: ReportsResponse;
  fingerprint: FingerprintResponse;
}
