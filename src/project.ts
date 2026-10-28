import fs from "node:fs";
import path from "node:path";

import json5 from "json5";
import type {
  cruise as cruiseFn,
  ICruiseOptions,
  IConfiguration,
} from "dependency-cruiser";

// These defaults are used by DC's CLI, but not exported
const DEFAULT_CONFIG_FILE_NAMES = [
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.json",
];
const DEFAULT_BASELINE_FILE_NAME = ".dependency-cruiser-known-violations.json";

export interface Project {
  cwd: string;
  cruise: typeof cruiseFn;
  options: ICruiseOptions;
  tsConfig: unknown;
  comments: Map<string, string | undefined>;
  configFile: string;
  baselineFile: string;
}

/**
 * Loads all configuration files necessary (DC, DC baseline, TS).
 * Runs in the worker: dependency-cruiser is ESM-only, so it's loaded lazily
 * with `import()`.
 */
export async function loadProject(
  cwd: string,
  configPath: string | undefined,
  knownViolationsPath: string | undefined
): Promise<Project> {
  const { cruise } = await import("dependency-cruiser");
  const { default: extractDepcruiseConfig } = await import(
    "dependency-cruiser/config-utl/extract-depcruise-config"
  );
  const { default: extractTSConfig } = await import(
    "dependency-cruiser/config-utl/extract-ts-config"
  );

  const configFile = findConfigFile(cwd, configPath);
  const config: IConfiguration = await extractDepcruiseConfig(
    configFile,
    new Set(),
    cwd
  );
  const options = configurationToOptions(config);

  // DC resolves tsConfig.fileName against process.cwd(), and a worker can't
  // chdir, so make it absolute up front.
  let tsConfig: unknown;
  if (options.tsConfig?.fileName) {
    options.tsConfig.fileName = path.resolve(cwd, options.tsConfig.fileName);
    tsConfig = extractTSConfig(options.tsConfig.fileName);
  }

  const baselineFile = path.resolve(
    cwd,
    knownViolationsPath ?? DEFAULT_BASELINE_FILE_NAME
  );

  return {
    cwd,
    cruise,
    options,
    tsConfig,
    comments: collectRuleComments(config),
    configFile,
    baselineFile,
  };
}

/**
 * Finds the DC configuration, either in a location provided by the user via
 * ESLint settings (`'dependency-cruiser'.config`) or in one of DC's default
 * locations. Since the configuration is where the dependency rules are
 * specified, it doesn't make sense to run this rule without one.
 */
function findConfigFile(cwd: string, configPath: string | undefined) {
  if (configPath) {
    return path.resolve(cwd, configPath);
  }
  for (const fileName of DEFAULT_CONFIG_FILE_NAMES) {
    const candidate = path.join(cwd, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `A dependency-cruiser configuration file is necessary to use this rule. ` +
      `None of ${DEFAULT_CONFIG_FILE_NAMES.join(", ")} was found in ${cwd}; ` +
      `set settings['dependency-cruiser'].config to point to one.`
  );
}

/**
 * Same as DC's `extract-depcruise-options`, which can't be used directly
 * because it resolves `extends` against process.cwd().
 */
function configurationToOptions(config: IConfiguration): ICruiseOptions {
  const { options, ...ruleSet } = structuredClone(config);
  return {
    ...options,
    ruleSet,
    validate: Object.keys(ruleSet).length > 0,
  } as ICruiseOptions;
}

/**
 * Loads the user's DC baseline file, which can be used to ignore known
 * violations. A missing or unreadable file means no baseline. Read on every
 * cruise, since `depcruise --baseline` rewrites it while an editor is open.
 * @see https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md#--ignore-known-ignore-known-violations
 */
export function loadKnownViolations(baselineFile: string) {
  try {
    return json5.parse(
      fs.readFileSync(baselineFile, "utf-8")
    ) as ICruiseOptions["knownViolations"];
  } catch {
    return undefined;
  }
}

/**
 * Rule comments are part of the config, not of the violations DC reports, so
 * collect them once for the error messages.
 */
function collectRuleComments(config: IConfiguration) {
  const comments = new Map<string, string | undefined>();
  for (const rule of [...(config.forbidden ?? []), ...(config.required ?? [])]) {
    if (rule.name) {
      comments.set(rule.name, rule.comment);
    }
  }
  if (config.allowed) {
    comments.set("not-in-allowed", undefined);
  }
  return comments;
}
