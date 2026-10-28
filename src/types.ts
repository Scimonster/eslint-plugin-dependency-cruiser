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
  /** How long (ms) to wait for the dependency-cruiser worker before failing */
  timeout?: number;
}

/**
 * What the rule sends to the worker. Only plain data, since it crosses a thread
 * boundary via structured clone.
 */
export interface CruiseRequest {
  cwd: string;
  configPath?: string;
  knownViolationsPath?: string;
  file: string;
}

export interface Violation {
  name: string;
  severity: SeverityType;
  comment?: string;
}

export interface CruisedDependency {
  /** The import source as written in the file, e.g. "./bar" */
  module: string;
  rules: Violation[];
}

export interface CruiseResponse {
  dependencies: CruisedDependency[];
}
