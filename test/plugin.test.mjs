import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const basic = path.join(fixtures, "basic");

async function lintBasic(file) {
  // Uses the fixture's eslint.config.ts, which ESLint loads through jiti
  const eslint = new ESLint({ cwd: basic });
  const [result] = await eslint.lintFiles([file]);
  return result.messages.map(({ ruleId, severity, line, message }) => ({
    ruleId,
    severity,
    line,
    message,
  }));
}

describe("loading", () => {
  it("exports the plugin from require()", () => {
    const plugin = createRequire(import.meta.url)("eslint-plugin-dependency-cruiser");
    assert.ok(plugin.rules.errors);
    assert.ok(plugin.rules.warnings);
    assert.equal(plugin.configs.all.plugins["dependency-cruiser"], plugin);
  });

  it("exports the plugin from import()", async () => {
    const { default: plugin } = await import("eslint-plugin-dependency-cruiser");
    assert.ok(plugin.rules.errors);
    assert.equal(plugin.configs.all.plugins["dependency-cruiser"], plugin);
  });
});

describe("rules", () => {
  it("reports error and warn violations on their imports", async () => {
    assert.deepEqual(await lintBasic("src/features/a/index.ts"), [
      {
        ruleId: "dependency-cruiser/errors",
        severity: 2,
        line: 1,
        message: "no-cross-feature (../b/index): Features can't import each other",
      },
      {
        ruleId: "dependency-cruiser/warnings",
        severity: 1,
        line: 2,
        message: "no-legacy (../../legacy/old): Don't add new imports of legacy code",
      },
    ]);
  });

  it("doesn't report violations from the baseline", async () => {
    assert.deepEqual(await lintBasic("src/features/b/known.ts"), []);
  });

  it("doesn't report valid files", async () => {
    assert.deepEqual(await lintBasic("src/features/b/index.ts"), []);
  });

  it("fails clearly without a dependency-cruiser config", async () => {
    const { default: plugin } = await import("eslint-plugin-dependency-cruiser");
    const eslint = new ESLint({
      cwd: path.join(fixtures, "no-config"),
      overrideConfigFile: true,
      overrideConfig: [
        { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
        plugin.configs.all,
      ],
    });
    await assert.rejects(
      eslint.lintFiles(["src/index.ts"]),
      /dependency-cruiser configuration file is necessary/
    );
  });
});
