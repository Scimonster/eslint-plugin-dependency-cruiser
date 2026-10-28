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
}

/**
 * What the rule sends to the worker. Only plain data, since it crosses a thread
 * boundary via structured clone.
 */
export interface ReportsRequest {
  cwd: string;
  configPath?: string;
  knownViolationsPath?: string;
  roots: string[];
  cache: boolean;
  ttl: number;
  /** Absolute path of the linted file */
  file: string;
}

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

export interface ReportsResponse {
  reports: Report[];
  /** Number of full cruises this project has done; only set for debugging */
  cruises?: number;
}
