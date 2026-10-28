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
and `.dependency-cruiser-known-violations.json`). You can configure that using
ESLint's settings, specifying `dependency-cruiser` key with a value of an object
with `config` and `knownViolations`. Paths are relative to ESLint's working
directory. For example:

```js
export default [
  dependencyCruiser.configs.all,
  {
    settings: {
      "dependency-cruiser": {
        knownViolations: ".dependency-cruiser-baseline.json",
        config: ".dependency-cruiser.cjs",
        // How long to wait for Dependency Cruiser before failing, in ms
        timeout: 60000,
      },
    },
  },
];
```

Violations listed in the baseline file are not reported.

## How it works

Dependency Cruiser is ESM-only and its API is asynchronous, but ESLint rules
must be synchronous. The plugin runs Dependency Cruiser in a worker thread
(via [synckit](https://github.com/un-ts/synckit)) and blocks on it from the
rule. The worker is started on first use and reused for the rest of the ESLint
process.

## Limitations

The plugin is not exposing all validation features or configuration options of
Dependency Cruiser. Some things missing:

- Support for loading webpack configuration
- Support for detecting violations that require cruising the whole dependency
  tree, e.g. circular dependencies
- Violations are only reported on `import` declarations, not on `export ... from`,
  dynamic `import()` or `require()`

## Performance

In the current iteration, this plugin is fairly slow. It runs Dependency Cruiser to analyse
dependencies of each file. This makes it perform OK in development when ran by the editor on 
a single file, but adds up quickly if running a full ESLint check for a large codebase.
