import type { ESLint, Linter } from "eslint";

import { getDependencyCruiserRule } from "./rule";

declare const __PACKAGE_VERSION__: string;

const plugin = {
  meta: {
    name: "eslint-plugin-dependency-cruiser",
    version: __PACKAGE_VERSION__,
  },
  rules: {
    errors: getDependencyCruiserRule("error"),
    warnings: getDependencyCruiserRule("warn"),
  },
  configs: {} as { all: Linter.Config },
} satisfies ESLint.Plugin;

plugin.configs.all = {
  name: "dependency-cruiser/all",
  plugins: { "dependency-cruiser": plugin },
  rules: {
    "dependency-cruiser/errors": "error",
    "dependency-cruiser/warnings": "warn",
  },
};

export default plugin;
