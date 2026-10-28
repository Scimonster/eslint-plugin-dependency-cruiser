import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { ICruiseOptions, ICruiseResult } from "dependency-cruiser";
import { buildIndex } from "./graph-index";
import { loadKnownViolations, loadProject, type Project } from "./project";
import type { Report } from "./types";

const DISK_CACHE_FOLDER = "node_modules/.cache/eslint-plugin-dependency-cruiser";

interface Options {
  cwd: string;
  configPath?: string;
  knownViolationsPath?: string;
  roots: string[];
  cache: boolean;
  ttl: number;
}

interface State {
  index: Map<string, Report[]>;
  /** Content hash of every file the index knows about, by relative path */
  hashes: Map<string, string | null>;
  /** When the cruise started; files modified since may not be in the index */
  at: number;
  configMtime: number | null;
  baselineMtime: number | null;
}

/**
 * Keeps the reports of a whole-graph cruise in memory, so each rule call is a
 * lookup. One instance per project, living in the worker.
 *
 * The first cruise may use dependency-cruiser's disk cache with the `metadata`
 * strategy, which is keyed on git HEAD plus uncommitted changes, so it's always
 * current. After that the graph is re-cruised (without the disk cache, which
 * would miss anyway) when:
 * - the linted file's content differs from what was cruised, or it's new.
 *   This is the file the user just saved, so the caller waits for the cruise.
 * - the config changed. The caller waits for this too.
 * - a watcher saw a change under the roots. This is what catches an edit to A
 *   changing B's result (a broken cycle, a new orphan).
 * - the graph is older than the TTL, as a backstop for missed watcher events.
 * - the baseline changed.
 * For the last three, the stale graph is served while a refresh runs in the
 * background. In a CLI run nothing changes, so none of these fire.
 */
export class GraphCache {
  cruises = 0;
  #options: Options;
  #project: Project | undefined;
  #state: State | undefined;
  #dirty = false;
  #refreshing: Promise<void> | undefined;
  #watchers: fs.FSWatcher[] = [];

  constructor(options: Options) {
    this.#options = options;
  }

  close() {
    for (const watcher of this.#watchers) {
      watcher.close();
    }
    this.#watchers = [];
  }

  /** Reports for one file, as a path relative to the project's cwd */
  async get(file: string): Promise<Report[]> {
    const absoluteFile = this.#resolve(file);
    const hash = hashFile(absoluteFile);
    if (
      !this.#state ||
      this.#changedSinceCruise(file, absoluteFile, hash) ||
      mtime(this.#project!.configFile) !== this.#state.configMtime
    ) {
      await this.#refresh();
    } else if (
      this.#dirty ||
      Date.now() - this.#state.at > this.#options.ttl ||
      mtime(this.#project!.baselineFile) !== this.#state.baselineMtime
    ) {
      void this.#refresh().catch(() => {
        // Served stale; the next foreground refresh will surface the error
      });
    }

    const state = this.#state!;
    // Remember files the graph doesn't include (excluded, or outside the
    // cruise), so they don't trigger a re-cruise on every call.
    if (!state.hashes.has(file)) {
      state.hashes.set(file, hash);
    }
    return state.index.get(file) ?? [];
  }

  /**
   * Whether a file differs from what the index was built from. A file the
   * index doesn't know about only counts as changed if it was modified after
   * the cruise started; otherwise dependency-cruiser saw it and excluded it
   * (e.g. tests), and re-cruising wouldn't change anything.
   */
  #changedSinceCruise(file: string, absoluteFile: string, hash: string | null) {
    const state = this.#state!;
    if (state.hashes.has(file)) {
      return state.hashes.get(file) !== hash;
    }
    return (mtime(absoluteFile) ?? 0) >= state.at;
  }

  #refresh(): Promise<void> {
    this.#refreshing ??= this.#cruise().finally(() => {
      this.#refreshing = undefined;
    });
    return this.#refreshing;
  }

  async #cruise() {
    // Cleared before cruising, so edits made during the cruise trigger another
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
    let result: ICruiseResult;
    try {
      result = await this.#cruiseRoots(
        roots,
        firstCruise && this.#options.cache
      );
    } catch (error) {
      if (!(firstCruise && this.#options.cache)) {
        throw error;
      }
      // The disk cache needs e.g. a git repo; fall back to a plain cruise
      result = await this.#cruiseRoots(roots, false);
    }
    this.cruises++;

    const hashes = new Map<string, string | null>();
    for (const module of result.modules) {
      if (
        module.coreModule ||
        module.couldNotResolve ||
        !this.#isUnderRoots(module.source)
      ) {
        continue;
      }
      hashes.set(module.source, hashFile(this.#resolve(module.source)));
    }

    this.#state = {
      index: buildIndex(result, project.comments),
      hashes,
      at: startedAt,
      configMtime: mtime(project.configFile),
      baselineMtime,
    };

    if (firstCruise) {
      this.#watch(roots);
    }
  }

  async #cruiseRoots(roots: string[], useDiskCache: boolean) {
    const { cruise, options, tsConfig, baselineFile } = this.#project!;
    const knownViolations = loadKnownViolations(baselineFile);
    const { output } = await cruise(
      // Always the same roots and options, or the disk cache misses
      roots,
      {
        ...options,
        ...(knownViolations ? { knownViolations } : {}),
        baseDir: this.#options.cwd,
        cache: useDiskCache
          ? ({
              folder: this.#resolve(DISK_CACHE_FOLDER),
              strategy: "metadata",
            } as ICruiseOptions["cache"])
          : false,
      },
      // Webpack configuration is not supported currently, contributions welcome!
      undefined,
      { tsConfig } as Parameters<typeof cruise>[3]
    );
    if (typeof output === "string") {
      throw new Error("dependency-cruiser: JSON output format expected");
    }
    return output;
  }

  #existingRoots() {
    const roots = this.#options.roots.filter((root) =>
      fs.existsSync(this.#resolve(root))
    );
    if (roots.length === 0) {
      throw new Error(
        `None of the roots to cruise (${this.#options.roots.join(", ")}) ` +
          `exist in ${this.#options.cwd}; set settings['dependency-cruiser'].roots.`
      );
    }
    return roots;
  }

  #watch(roots: string[]) {
    for (const root of roots) {
      try {
        this.#watchers.push(
          fs.watch(
            this.#resolve(root),
            { recursive: true, persistent: false },
            () => {
              this.#dirty = true;
            }
          )
        );
      } catch {
        // No watcher (e.g. unsupported platform): the TTL still applies
      }
    }
  }

  #isUnderRoots(file: string) {
    return isUnderRoots(this.#options.cwd, this.#options.roots, this.#resolve(file));
  }

  #resolve(file: string) {
    return path.resolve(this.#options.cwd, file);
  }
}

export function isUnderRoots(cwd: string, roots: string[], absoluteFile: string) {
  return roots.some((root) => {
    const relative = path.relative(path.resolve(cwd, root), absoluteFile);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

function hashFile(file: string) {
  try {
    return createHash("sha1").update(fs.readFileSync(file)).digest("base64");
  } catch {
    return null;
  }
}

function mtime(file: string) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}
