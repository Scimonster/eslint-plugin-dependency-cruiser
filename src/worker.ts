import fs from "node:fs";
import path from "node:path";

import json5 from "json5";
import { runAsWorker } from "synckit";
import type {
  cruise as cruiseFn,
  ICruiseOptions,
  IConfiguration,
} from "dependency-cruiser";
import type { CruiseRequest, CruiseResponse } from "./types";

// This module runs in a worker thread started by synckit. dependency-cruiser is
// ESM-only and uses top-level await, so it can't be `require`d from the ESLint
// thread; here it's loaded lazily with `import()`.
// Keep the top level of this file trivial: if it throws while loading, synckit
// can only notice via its timeout.

// These defaults are used by DC's CLI, but not exported
const DEFAULT_CONFIG_FILE_NAMES = [
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.json",
];
const DEFAULT_BASELINE_FILE_NAME = ".dependency-cruiser-known-violations.json";

interface State {
  key: string;
  cruise: typeof cruiseFn;
  options: ICruiseOptions;
  tsConfig: unknown;
  comments: Map<string, string | undefined>;
}

let state: State | undefined;

/**
 * Loads all configuration files necessary (DC, DC baseline, TS) once per
 * combination of cwd and settings, and memoises them for consecutive runs.
 */
async function getState(request: CruiseRequest): Promise<State> {
  const { cwd, configPath, knownViolationsPath } = request;
  const key = JSON.stringify([cwd, configPath, knownViolationsPath]);
  if (state?.key === key) {
    return state;
  }

  const { cruise } = await import("dependency-cruiser");
  const { default: extractDepcruiseConfig } = await import(
    "dependency-cruiser/config-utl/extract-depcruise-config"
  );
  const { default: extractTSConfig } = await import(
    "dependency-cruiser/config-utl/extract-ts-config"
  );

  const config: IConfiguration = await extractDepcruiseConfig(
    findConfigFile(cwd, configPath),
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

  const knownViolations = loadKnownViolations(cwd, knownViolationsPath);
  if (knownViolations) {
    options.knownViolations = knownViolations;
  }

  state = {
    key,
    cruise,
    options,
    tsConfig,
    comments: collectRuleComments(config),
  };
  return state;
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
 * violations. A missing or unreadable file means no baseline.
 * @see https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md#--ignore-known-ignore-known-violations
 */
function loadKnownViolations(cwd: string, knownViolationsPath?: string) {
  const fileName = path.resolve(
    cwd,
    knownViolationsPath ?? DEFAULT_BASELINE_FILE_NAME
  );
  try {
    return json5.parse(
      fs.readFileSync(fileName, "utf-8")
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

/**
 * Cruises a single file, one level deep. ESLint runs the rule for each file,
 * so we only need to know about its direct dependencies. This makes rules
 * like circular dependencies impossible to detect, but performs acceptably.
 */
export async function cruiseFile(
  request: CruiseRequest
): Promise<CruiseResponse> {
  const { cruise, options, tsConfig, comments } = await getState(request);
  const relativeFile = path.relative(request.cwd, request.file);

  const result = await cruise(
    [relativeFile],
    { ...options, baseDir: request.cwd, maxDepth: 1 },
    // Webpack configuration is not supported currently, contributions welcome!
    undefined,
    { tsConfig } as Parameters<typeof cruise>[3]
  );

  if (typeof result.output === "string") {
    throw new Error("dependency-cruiser: JSON output format expected");
  }
  const cruisedModule =
    result.output.modules.find((module) => module.source === relativeFile) ??
    result.output.modules[0];

  return {
    dependencies: (cruisedModule?.dependencies ?? [])
      .filter((dependency) => !dependency.valid && dependency.rules)
      .map((dependency) => ({
        module: dependency.module,
        rules: dependency.rules!.map((rule) => ({
          name: rule.name,
          severity: rule.severity,
          comment: comments.get(rule.name),
        })),
      })),
  };
}

runAsWorker(cruiseFile);
