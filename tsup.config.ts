import { defineConfig } from "tsup";

import packageJson from "./package.json";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["cjs", "esm"],
    dts: true,
    shims: true,
    clean: true,
    define: { __PACKAGE_VERSION__: JSON.stringify(packageJson.version) },
    splitting: false,
    // CJS consumers get the plugin itself from `require()`, not `{ default }`
    footer: ({ format }) =>
      format === "cjs" ? { js: "module.exports = module.exports.default;" } : {},
  },
  {
    // The worker runs dependency-cruiser, which is ESM-only, so it's always ESM
    entry: ["src/worker.ts"],
    format: ["esm"],
    outExtension: () => ({ js: ".mjs" }),
  },
]);
