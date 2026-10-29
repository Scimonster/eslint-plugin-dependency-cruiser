import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { createSyncFn } from "synckit";

// Makes the worker return how many full cruises each project did
process.env.DEPCRUISE_ESLINT_DEBUG = "1";

const root = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(root, "fixtures", "graph");
const getReports = createSyncFn(path.join(root, "..", "dist", "worker.mjs"), {
  timeout: 60_000,
});

describe("whole-graph rules", () => {
  it("reports cycles on each edge's import, orphans on line 1, and skips the baseline", async () => {
    const eslint = new ESLint({ cwd: fixture });
    const results = await eslint.lintFiles(["src"]);
    const messages = results.flatMap((result) =>
      result.messages.map(({ ruleId, severity, line, column, message }) => ({
        file: path.relative(fixture, result.filePath),
        ruleId,
        severity,
        line,
        column,
        message,
      }))
    );
    const cycle = (file, source, column, ...files) => ({
      file: `src/${file}`,
      ruleId: "dependency-cruiser/errors",
      severity: 2,
      line: 2,
      column,
      message: `no-circular (${source}): Circular dependencies are not allowed [${files
        .map((name) => `src/${name}`)
        .join(" -> ")}]`,
    });

    assert.deepEqual(messages, [
      // import
      cycle("a.ts", "./b", 1, "a.ts", "b.ts", "a.ts"),
      // export * from
      cycle("b.ts", "./a", 1, "b.ts", "a.ts", "b.ts"),
      // import()
      cycle("c.ts", "./d", 37, "c.ts", "d.ts", "c.ts"),
      cycle("d.ts", "./c", 1, "d.ts", "c.ts", "d.ts"),
      // require()
      cycle("f.cjs", "./req.cjs", 29, "f.cjs", "req.cjs", "f.cjs"),
      // import type
      cycle("g.ts", "./h", 1, "g.ts", "h.ts", "g.ts"),
      // import = require()
      cycle("h.ts", "./g", 1, "h.ts", "g.ts", "h.ts"),
      {
        file: "src/orphan.ts",
        ruleId: "dependency-cruiser/warnings",
        severity: 1,
        line: 1,
        column: 1,
        message:
          "no-orphans: Modules nothing depends on, and that depend on nothing",
      },
      cycle("req.cjs", "./f.cjs", 15, "req.cjs", "f.cjs", "req.cjs"),
      // x.ts <-> y.ts is in the baseline
    ]);
  });
});

describe("graph invalidation", () => {
  let cwd;
  const request = (file) =>
    getReports({ cwd, roots: ["src"], cache: true, ttl: 60_000, file: path.join(cwd, file) });
  const names = (file) => request(file).reports.map((report) => report.name);
  const cruises = () => request("src/index.ts").cruises;
  const write = (file, text) => fs.writeFileSync(path.join(cwd, file), text);
  // Background refreshes finish between calls; poll until one lands
  async function eventually(check) {
    for (let attempt = 0; attempt < 50; attempt++) {
      if (check()) {
        return;
      }
      await sleep(100);
    }
    assert.fail("condition never became true");
  }

  before(() => {
    // Outside the repo, so dependency-cruiser's git-based disk cache can't be
    // used and the plugin has to fall back to a plain cruise
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "depcruise-eslint-"));
    fs.cpSync(fixture, cwd, {
      recursive: true,
      filter: (source) => !source.includes("node_modules"),
    });
  });

  after(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("cruises once while nothing changes", () => {
    assert.deepEqual(names("src/b.ts"), ["no-circular"]);
    for (const file of fs.readdirSync(path.join(cwd, "src"))) {
      request(`src/${file}`);
    }
    // notes.md isn't in the graph; asking again must not re-cruise
    request("src/notes.md");
    assert.equal(cruises(), 1);
  });

  it("re-cruises before answering when the linted file changed", () => {
    write("src/d.ts", "export const d = 1;\n");
    assert.deepEqual(names("src/d.ts"), []);
    assert.deepEqual(names("src/c.ts"), []);
  });

  it("catches up when another file changed", async () => {
    // Breaks the a <-> b cycle by editing a.ts only
    write("src/a.ts", "export const a = 1;\n");
    await eventually(() => names("src/b.ts").length === 0);
  });

  it("catches up when the baseline changed", async () => {
    fs.rmSync(path.join(cwd, ".dependency-cruiser-known-violations.json"));
    await eventually(() => names("src/x.ts").includes("no-circular"));
  });
});

describe("graph TTL", () => {
  let cwd;
  before(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "depcruise-eslint-ttl-"));
    fs.cpSync(fixture, cwd, {
      recursive: true,
      filter: (source) => !source.includes("node_modules"),
    });
  });
  after(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("doesn't re-cruise when the TTL expires and nothing changed", async () => {
    const request = (file) =>
      getReports({ kind: "reports", cwd, roots: ["src"], cache: false, ttl: 0, file: path.join(cwd, file) });
    assert.deepEqual(request("src/b.ts").reports.map((report) => report.name), ["no-circular"]);
    for (const file of ["src/a.ts", "src/b.ts", "src/c.ts", "src/notes.md"]) {
      await sleep(20);
      request(file);
    }
    // Give any background refresh time to finish before counting
    await sleep(500);
    assert.equal(request("src/a.ts").cruises, 1);
  });
});
