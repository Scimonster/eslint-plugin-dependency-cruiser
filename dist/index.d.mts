import * as eslint from 'eslint';
import { Linter } from 'eslint';

/**
 * Settings read from ESLint's shared `settings['dependency-cruiser']`.
 */
interface PluginSettings {
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
declare function withGraphFingerprint<Settings extends PluginSettings>(settings: Settings, { cwd }?: {
    cwd?: string;
}): Settings & {
    graph: string;
};

declare const plugin: {
    meta: {
        name: string;
        version: string;
    };
    rules: {
        errors: eslint.Rule.RuleModule;
        warnings: eslint.Rule.RuleModule;
    };
    configs: {
        all: Linter.Config;
    };
    withGraphFingerprint: typeof withGraphFingerprint;
};

export { plugin as default };
