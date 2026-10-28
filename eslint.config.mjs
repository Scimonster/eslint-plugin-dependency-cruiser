import js from "@eslint/js";
import eslintPlugin from "eslint-plugin-eslint-plugin";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "example/", "test/fixtures/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    ...eslintPlugin.configs.recommended,
    rules: {
      ...eslintPlugin.configs.recommended.rules,
      "eslint-plugin/require-meta-docs-description": "error",
    },
  },
  {
    files: ["test/**/*.mjs"],
    languageOptions: { globals: { process: "readonly" } },
  }
);
