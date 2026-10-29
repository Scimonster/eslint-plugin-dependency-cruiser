import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(root, "fixtures");
const eslintBin = path.join(path.dirname(require.resolve("eslint/package.json")), "bin", "eslint.js");

/**
 * Copies a fixture to a temporary folder with an ESLint config that imports
 * the built plugin, optionally using `withGraphFingerprint`.
 */
function setUpProject({ fingerprint, fixture = "graph", inside = os.tmpdir() }) {
  const cwd = fs.mkdtempSync(path.join(inside, "depcruise-eslint-cli-"));
  fs.cpSync(path.join(fixtures, fixture), cwd, {
    recursive: true,
    filter: (source) => !source.includes("node_modules"),
  });
  const plugin = pathToFileURL(path.join(root, "..", "dist", "index.mjs"));
  const tseslint = pathToFileURL(require.resolve("typescript-eslint"));
  fs.rmSync(path.join(cwd, "eslint.config.ts"), { force: true });
  fs.writeFileSync(
    path.join(cwd, "eslint.config.mjs"),
    `import tseslint from "${tseslint}";
import dependencyCruiser from "${plugin}";

const settings = { roots: ["src"] };

export default [
  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs" } },
  dependencyCruiser.configs.all,
  {
    settings: {
      "dependency-cruiser": ${
        fingerprint ? "dependencyCruiser.withGraphFingerprint(settings)" : "settings"
      },
    },
  },
];
`
  );
  return cwd;
}

/** Runs the ESLint CLI and returns `{ file: ["rule-name", ...] }` */
function lint(cwd, ...args) {
  const { stdout, stderr, status } = spawnSync(
    process.execPath,
    [eslintBin, "-f", "json", ...args, "src"],
    { cwd, encoding: "utf8", env: { ...process.env, DEBUG: "eslint:*" } }
  );
  assert.ok(status === 0 || status === 1, `ESLint failed:\n${stderr}`);
  const violations = {};
  for (const result of JSON.parse(stdout)) {
    for (const message of result.messages) {
      assert.ok(message.ruleId, `ESLint reported: ${message.message}`);
      const file = path.relative(cwd, result.filePath);
      (violations[file] ??= []).push(message.message.split(/[ :]/)[0]);
    }
  }
  const skipped = stderr.match(/Skipping file since it hasn't changed/g) ?? [];
  return { violations, skipped: skipped.length };
}

const breakCycle = (cwd) =>
  fs.writeFileSync(
    path.join(cwd, "src", "a.ts"),
    "// The a <-> b cycle, broken\nexport const a = 1;\n"
  );

describe("eslint --cache", () => {
  const projects = [];
  after(() => {
    for (const cwd of projects) {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("re-lints other files when the graph's violations change", () => {
    const cwd = setUpProject({ fingerprint: true });
    projects.push(cwd);
    assert.deepEqual(lint(cwd, "--cache").violations["src/b.ts"], ["no-circular"]);

    breakCycle(cwd);
    assert.equal(lint(cwd, "--cache").violations["src/b.ts"], undefined);
  });

  it("re-lints nothing when nothing changed", () => {
    const cwd = setUpProject({ fingerprint: true });
    projects.push(cwd);
    const first = lint(cwd, "--cache");
    const second = lint(cwd, "--cache");
    assert.deepEqual(second.violations, first.violations);
    const linted = fs
      .readdirSync(path.join(cwd, "src"))
      .filter((file) => /\.(ts|cjs)$/.test(file));
    assert.equal(second.skipped, linted.length);
  });

  it("keeps stale results without the fingerprint", () => {
    const cwd = setUpProject({ fingerprint: false });
    projects.push(cwd);
    lint(cwd, "--cache");

    breakCycle(cwd);
    assert.deepEqual(lint(cwd, "--cache").violations["src/b.ts"], ["no-circular"]);
  });
});

describe("eslint --concurrency", () => {
  let cwd;
  before(() => {
    // Inside the repo, so dependency-cruiser's git-based disk cache is used
    cwd = setUpProject({ fingerprint: true, inside: fixtures });
  });
  after(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("reports the same as a single thread", () => {
    const single = lint(cwd);
    assert.deepEqual(lint(cwd, "--concurrency", "2").violations, single.violations);
    assert.ok(Object.keys(single.violations).length > 0);
  });
});
