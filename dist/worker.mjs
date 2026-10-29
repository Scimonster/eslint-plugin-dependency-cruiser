// src/worker.ts
import path3 from "path";
import { runAsWorker } from "synckit";

// src/graph-cache.ts
import { createHash } from "crypto";
import fs2 from "fs";
import path2 from "path";

// src/graph-index.ts
function buildIndex(result, comments) {
  const index = /* @__PURE__ */ new Map();
  const push = (file, report) => {
    let reports = index.get(file);
    if (!reports) {
      reports = [];
      index.set(file, reports);
    }
    reports.push(report);
  };
  for (const module of result.modules) {
    for (const rule of module.rules ?? []) {
      if (rule.severity === "ignore") {
        continue;
      }
      push(module.source, {
        name: rule.name,
        severity: rule.severity,
        comment: comments.get(rule.name),
        at: "file"
      });
    }
    for (const dependency of module.dependencies) {
      for (const rule of dependency.rules ?? []) {
        if (rule.severity === "ignore") {
          continue;
        }
        push(module.source, {
          name: rule.name,
          severity: rule.severity,
          comment: comments.get(rule.name),
          at: "import",
          specifier: dependency.module,
          ...dependency.cycle ? {
            cycle: [
              module.source,
              ...dependency.cycle.map((step) => step.name)
            ]
          } : {}
        });
      }
    }
  }
  return index;
}

// src/project.ts
import fs from "fs";
import path from "path";
import json5 from "json5";
var DEFAULT_CONFIG_FILE_NAMES = [
  ".dependency-cruiser.js",
  ".dependency-cruiser.cjs",
  ".dependency-cruiser.mjs",
  ".dependency-cruiser.json"
];
var DEFAULT_BASELINE_FILE_NAME = ".dependency-cruiser-known-violations.json";
async function loadProject(cwd, configPath, knownViolationsPath) {
  const { cruise } = await import("dependency-cruiser");
  const { default: extractDepcruiseConfig } = await import("dependency-cruiser/config-utl/extract-depcruise-config");
  const { default: extractTSConfig } = await import("dependency-cruiser/config-utl/extract-ts-config");
  const configFile = findConfigFile(cwd, configPath);
  const config = await extractDepcruiseConfig(
    configFile,
    /* @__PURE__ */ new Set(),
    cwd
  );
  const options = configurationToOptions(config);
  let tsConfig;
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
    baselineFile
  };
}
function findConfigFile(cwd, configPath) {
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
    `A dependency-cruiser configuration file is necessary to use this rule. None of ${DEFAULT_CONFIG_FILE_NAMES.join(", ")} was found in ${cwd}; set settings['dependency-cruiser'].config to point to one.`
  );
}
function configurationToOptions(config) {
  const { options, ...ruleSet } = structuredClone(config);
  return {
    ...options,
    ruleSet,
    validate: Object.keys(ruleSet).length > 0
  };
}
function loadKnownViolations(baselineFile) {
  try {
    return json5.parse(
      fs.readFileSync(baselineFile, "utf-8")
    );
  } catch {
    return void 0;
  }
}
function collectRuleComments(config) {
  const comments = /* @__PURE__ */ new Map();
  for (const rule of [...config.forbidden ?? [], ...config.required ?? []]) {
    if (rule.name) {
      comments.set(rule.name, rule.comment);
    }
  }
  if (config.allowed) {
    comments.set("not-in-allowed", void 0);
  }
  return comments;
}

// src/graph-cache.ts
var DISK_CACHE_FOLDER = "node_modules/.cache/eslint-plugin-dependency-cruiser";
var GraphCache = class {
  cruises = 0;
  #options;
  #project;
  #state;
  #dirty = false;
  #refreshing;
  #watchers = [];
  constructor(options) {
    this.#options = options;
  }
  close() {
    for (const watcher of this.#watchers) {
      watcher.close();
    }
    this.#watchers = [];
  }
  /** Reports for one file, as a path relative to the project's cwd */
  async get(file) {
    const absoluteFile = this.#resolve(file);
    const hash = hashFile(absoluteFile);
    await this.#ensureFresh(
      () => this.#changedSinceCruise(file, absoluteFile, hash)
    );
    const state = this.#state;
    if (!state.hashes.has(file)) {
      state.hashes.set(file, hash);
    }
    return state.index.get(file) ?? [];
  }
  /**
   * A short hash of every report in the index. It changes whenever any
   * violation anywhere appears or disappears, and only then.
   */
  async fingerprint() {
    await this.#ensureFresh(() => false);
    const state = this.#state;
    state.fingerprint ??= createHash("sha1").update(
      JSON.stringify(
        [...state.index].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      )
    ).digest("hex").slice(0, 16);
    return state.fingerprint;
  }
  /**
   * Waits for a re-cruise when there's no index yet, the config changed, or
   * `mustWait` says the caller needs one; otherwise starts one in the
   * background if the index may be stale, and serves the current index.
   */
  async #ensureFresh(mustWait) {
    if (!this.#state || mustWait() || mtime(this.#project.configFile) !== this.#state.configMtime) {
      await this.#refresh();
    } else if (this.#dirty || Date.now() - this.#state.at > this.#options.ttl || mtime(this.#project.baselineFile) !== this.#state.baselineMtime) {
      void this.#refresh().catch(() => {
      });
    }
  }
  /**
   * Whether a file differs from what the index was built from. A file the
   * index doesn't know about only counts as changed if it was modified after
   * the cruise started; otherwise dependency-cruiser saw it and excluded it
   * (e.g. tests), and re-cruising wouldn't change anything.
   */
  #changedSinceCruise(file, absoluteFile, hash) {
    const state = this.#state;
    if (state.hashes.has(file)) {
      return state.hashes.get(file) !== hash;
    }
    return (mtime(absoluteFile) ?? 0) >= state.at;
  }
  #refresh() {
    this.#refreshing ??= this.#cruise().finally(() => {
      this.#refreshing = void 0;
    });
    return this.#refreshing;
  }
  async #cruise() {
    this.#dirty = false;
    const { cwd, configPath, knownViolationsPath } = this.#options;
    const configMtime = this.#project && mtime(this.#project.configFile);
    if (!this.#project || configMtime !== this.#state?.configMtime) {
      this.#project = await loadProject(cwd, configPath, knownViolationsPath);
    }
    const project = this.#project;
    const roots = this.#existingRoots();
    const startedAt = Date.now();
    const firstCruise = this.cruises === 0;
    const baselineMtime = mtime(project.baselineFile);
    let result;
    try {
      result = await this.#cruiseRoots(
        roots,
        firstCruise && this.#options.cache
      );
    } catch (error) {
      if (!(firstCruise && this.#options.cache)) {
        throw error;
      }
      result = await this.#cruiseRoots(roots, false);
    }
    this.cruises++;
    const hashes = /* @__PURE__ */ new Map();
    for (const module of result.modules) {
      if (module.coreModule || module.couldNotResolve || !this.#isUnderRoots(module.source)) {
        continue;
      }
      hashes.set(module.source, hashFile(this.#resolve(module.source)));
    }
    this.#state = {
      index: buildIndex(result, project.comments),
      hashes,
      at: startedAt,
      configMtime: mtime(project.configFile),
      baselineMtime
    };
    if (firstCruise) {
      this.#watch(roots);
    }
  }
  async #cruiseRoots(roots, useDiskCache) {
    const { cruise, options, tsConfig, baselineFile } = this.#project;
    const knownViolations = loadKnownViolations(baselineFile);
    const { output } = await cruise(
      // Always the same roots and options, or the disk cache misses
      roots,
      {
        ...options,
        ...knownViolations ? { knownViolations } : {},
        baseDir: this.#options.cwd,
        cache: useDiskCache ? {
          folder: this.#resolve(DISK_CACHE_FOLDER),
          strategy: "metadata"
        } : false
      },
      // Webpack configuration is not supported currently, contributions welcome!
      void 0,
      { tsConfig }
    );
    if (typeof output === "string") {
      throw new Error("dependency-cruiser: JSON output format expected");
    }
    return output;
  }
  #existingRoots() {
    const roots = this.#options.roots.filter(
      (root) => fs2.existsSync(this.#resolve(root))
    );
    if (roots.length === 0) {
      throw new Error(
        `None of the roots to cruise (${this.#options.roots.join(", ")}) exist in ${this.#options.cwd}; set settings['dependency-cruiser'].roots.`
      );
    }
    return roots;
  }
  #watch(roots) {
    for (const root of roots) {
      try {
        this.#watchers.push(
          fs2.watch(
            this.#resolve(root),
            { recursive: true, persistent: false },
            () => {
              this.#dirty = true;
            }
          )
        );
      } catch {
      }
    }
  }
  #isUnderRoots(file) {
    return isUnderRoots(this.#options.cwd, this.#options.roots, this.#resolve(file));
  }
  #resolve(file) {
    return path2.resolve(this.#options.cwd, file);
  }
};
function isUnderRoots(cwd, roots, absoluteFile) {
  return roots.some((root) => {
    const relative = path2.relative(path2.resolve(cwd, root), absoluteFile);
    return !relative.startsWith("..") && !path2.isAbsolute(relative);
  });
}
function hashFile(file) {
  try {
    return createHash("sha1").update(fs2.readFileSync(file)).digest("base64");
  } catch {
    return null;
  }
}
function mtime(file) {
  try {
    return fs2.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// src/settings.ts
function projectKey(request) {
  const { cwd, configPath, knownViolationsPath, roots, cache } = request;
  return JSON.stringify([cwd, configPath, knownViolationsPath, roots, cache]);
}

// src/worker.ts
var graphs = /* @__PURE__ */ new Map();
function graphFor(request) {
  const key = projectKey(request);
  let graph = graphs.get(key);
  if (!graph) {
    const { cwd, configPath, knownViolationsPath, roots, cache, ttl } = request;
    graph = new GraphCache({ cwd, configPath, knownViolationsPath, roots, cache, ttl });
    graphs.set(key, graph);
  }
  return graph;
}
async function handle(request) {
  const graph = graphFor(request);
  const response = request.kind === "fingerprint" ? { fingerprint: await graph.fingerprint() } : { reports: await graph.get(path3.relative(request.cwd, request.file)) };
  return {
    ...response,
    ...process.env.DEPCRUISE_ESLINT_DEBUG ? { cruises: graph.cruises } : {}
  };
}
runAsWorker(handle);
export {
  handle
};
