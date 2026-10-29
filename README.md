# eslint-plugin-dependency-cruiser

Runs [Dependency Cruiser](https://github.com/sverweij/dependency-cruiser) as an
[ESLint](https://eslint.org) rule and reports import rule violations.

<img width="500" alt="ESLint Dependency Cruiser displaying an error in VSCode" src="https://user-images.githubusercontent.com/4643658/179498433-8c691601-9e47-4fe2-a85c-ef56693903f1.png">

## Installation

```console
npm install --save-dev eslint-plugin-dependency-cruiser
```

or

```console
yarn add --dev eslint-plugin-dependency-cruiser
```

`eslint-plugin-dependency-cruiser` does not install Dependency Cruiser or ESLint
for you. You must install these yourself.

Supported versions:

- ESLint 9 or 10 (flat config)
- Dependency Cruiser 18
- Node.js 22, 24 or 26+

Then, in your `eslint.config.js` (or `eslint.config.ts`):

```js
import dependencyCruiser from "eslint-plugin-dependency-cruiser";

export default [
  // ...your other configs
  dependencyCruiser.configs.all,
];
```

`configs.all` enables two rules: `dependency-cruiser/errors` reports
violations of Dependency Cruiser rules with `error` severity, and
`dependency-cruiser/warnings` reports those with `warn` severity.

## Configuration

By default the plugin looks for the Dependency Cruiser configuration and the
baseline file in the default locations (`.dependency-cruiser.{js,cjs,mjs,json}`
and `.dependency-cruiser-known-violations.json`), and cruises the `src` folder.
You can configure that using ESLint's settings, under the `dependency-cruiser`
key. Paths are relative to ESLint's working directory. For example:

```js
export default [
  dependencyCruiser.configs.all,
  {
    settings: {
      "dependency-cruiser": {
        config: ".dependency-cruiser.cjs",
        knownViolations: ".dependency-cruiser-baseline.json",
        // Folders to cruise; files outside them get no reports
        roots: ["src", "scripts"],
        // Whether the first cruise may use Dependency Cruiser's disk cache
        cache: true,
        // How often to check files on disk for changes the watcher missed, in ms
        ttl: 30000,
        // How long to wait for Dependency Cruiser before failing, in ms
        timeout: 60000,
      },
    },
  },
];
```

Violations listed in the baseline file are not reported.

## What gets reported

The plugin cruises the whole dependency graph, so it reports every kind of
violation Dependency Cruiser finds:

- Dependency violations (including each edge of a circular dependency) are
  reported on the `import`, `export ... from`, `import()`, `require()`,
  `import x = require()` or `import("x")` type that causes them. If none can be
  found (e.g. a JSDoc import), they're reported on the first line.
- Module violations (orphans, reachability) are reported on the first line.
- Folder violations have no file to report on, so they're not reported.

## How it works

Dependency Cruiser is ESM-only and its API is asynchronous, but ESLint rules
must be synchronous. The plugin runs Dependency Cruiser in a worker thread
(via [synckit](https://github.com/un-ts/synckit)) and blocks on it from the
rule. The worker is started on first use and reused for the rest of the ESLint
process.

The worker cruises the roots once, and keeps the violations of every file in
memory, so each file after the first is a lookup. The first cruise uses
Dependency Cruiser's disk cache (in
`node_modules/.cache/eslint-plugin-dependency-cruiser`), keyed on the git
commit and uncommitted changes, so it's fast when nothing changed since the
last run.

In an editor, the ESLint process lives on, and the graph is refreshed when:

- the file being linted changed on disk. ESLint waits for the refresh.
- any file under the roots changed, which is how an edit to one file updates
  the violations of another (e.g. a broken cycle). The previous results are
  served while the graph refreshes in the background, so other files catch up
  on their next lint.
- the baseline file changed (also in the background).
- a file in the graph was modified or deleted without the watcher noticing.
  This is checked every `ttl` by comparing modification times, so a long
  lint run where nothing changes never re-cruises.

## Using `--cache` and `--concurrency`

With `eslint --cache`, ESLint only re-lints files that changed. But a
dependency violation can change without its file changing: editing `a.ts` to
break a cycle should also clear the violation reported on `b.ts`. To handle
that, wrap the plugin's settings in `withGraphFingerprint`:

```js
import dependencyCruiser from "eslint-plugin-dependency-cruiser";

export default [
  dependencyCruiser.configs.all,
  {
    settings: {
      "dependency-cruiser": dependencyCruiser.withGraphFingerprint({
        config: ".dependency-cruiser.cjs",
      }),
    },
  },
];
```

It cruises the project when the config is loaded and adds a fingerprint of
all its violations to the settings, so ESLint re-lints every file whenever a
violation anywhere appears or disappears, and only then. The rules reuse that
cruise, so it doesn't add one.

It also helps `eslint --concurrency`: ESLint loads the config before it starts
its threads, so the cruise warms Dependency Cruiser's disk cache, and each
thread's own first cruise is a cache hit instead of a full cruise. The threads
reuse the fingerprint instead of computing it again.

`withGraphFingerprint` takes the same settings as above, and an optional
second argument `{ cwd }`, which defaults to `process.cwd()`. It must match
ESLint's working directory, or the fingerprint and the rules use separate
cruises.

## Limitations

The plugin is not exposing all validation features or configuration options of
Dependency Cruiser. Some things missing:

- Support for loading webpack configuration
- Unsaved editor changes aren't seen; Dependency Cruiser reads files from disk
- Changes to a JavaScript Dependency Cruiser config (`.js`, `.cjs`, `.mjs`)
  need an ESLint restart (e.g. "Restart ESLint Server" in VS Code), because
  Node caches imported modules. JSON configs are reloaded.
- With `eslint --cache` and without `withGraphFingerprint`, files that didn't
  change aren't re-linted, so their graph violations (e.g. a cycle through an
  edited file) can be stale

## Performance

A full ESLint run cruises the roots once, which takes about as long as running
Dependency Cruiser itself (less when its disk cache is warm), and then costs
well under a millisecond per file.
