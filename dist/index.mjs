// src/fingerprint.ts
import { createHash } from "crypto";
import { isMainThread } from "worker_threads";

// src/bridge.ts
import { createSyncFn } from "synckit";
var DEFAULT_TIMEOUT = 6e4;
var worker;
function callWorkerSync(request, timeout = DEFAULT_TIMEOUT) {
  if (!worker) {
    worker = createSyncFn(
      new URL("./worker.mjs", import.meta.url),
      { timeout }
    );
  }
  return worker(request);
}

// src/settings.ts
var DEFAULT_ROOTS = ["src"];
var DEFAULT_TTL = 3e4;
function toProjectRequest(cwd, settings) {
  return {
    cwd,
    configPath: settings.config,
    knownViolationsPath: settings.knownViolations ?? settings.knownViolationsFile,
    roots: settings.roots ?? DEFAULT_ROOTS,
    cache: settings.cache ?? true,
    ttl: settings.ttl ?? DEFAULT_TTL
  };
}
function projectKey(request) {
  const { cwd, configPath, knownViolationsPath, roots, cache } = request;
  return JSON.stringify([cwd, configPath, knownViolationsPath, roots, cache]);
}

// src/fingerprint.ts
function withGraphFingerprint(settings, { cwd = process.cwd() } = {}) {
  const request = toProjectRequest(cwd, settings);
  const envKey = `ESLINT_PLUGIN_DEPENDENCY_CRUISER_GRAPH_${createHash("sha1").update(projectKey(request)).digest("hex").slice(0, 12)}`;
  let graph = isMainThread ? void 0 : process.env[envKey];
  if (!graph) {
    graph = callWorkerSync(
      { kind: "fingerprint", ...request },
      settings.timeout
    ).fingerprint;
    process.env[envKey] = graph;
  }
  return { ...settings, graph };
}

// src/rule.ts
import path3 from "path";

// src/graph-cache.ts
import { createHash as createHash2 } from "crypto";
import fs2 from "fs";
import path2 from "path";

// src/project.ts
import fs from "fs";
import path from "path";
import json5 from "json5";

// src/graph-cache.ts
function isUnderRoots(cwd, roots, absoluteFile) {
  return roots.some((root) => {
    const relative = path2.relative(path2.resolve(cwd, root), absoluteFile);
    return !relative.startsWith("..") && !path2.isAbsolute(relative);
  });
}

// src/rule.ts
var DEFAULT_COMMENT = "Import violates the import rules";
function getDependencyCruiserRule(severity) {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Report dependency rule violations of ${severity} severity, found by Dependency Cruiser`,
        recommended: true,
        url: "https://github.com/Scimonster/eslint-plugin-dependency-cruiser"
      },
      messages: {
        violation: "{{name}} ({{source}}): {{comment}}",
        cycle: "{{name}} ({{source}}): {{comment}} [{{path}}]",
        module: "{{name}}: {{comment}}"
      },
      schema: []
    },
    create(context) {
      const settings = context.settings["dependency-cruiser"] ?? {};
      const cwd = context.cwd;
      const file = context.physicalFilename;
      const project = toProjectRequest(cwd, settings);
      if (!path3.isAbsolute(file) || !isUnderRoots(cwd, project.roots, file)) {
        return {};
      }
      const reports = callWorkerSync(
        { kind: "reports", ...project, file },
        settings.timeout
      ).reports.filter((report) => report.severity === severity);
      if (reports.length === 0) {
        return {};
      }
      const importNodes = /* @__PURE__ */ new Map();
      const collect = (node, source) => {
        if (node && typeof source === "string" && !importNodes.has(source)) {
          importNodes.set(source, node);
        }
      };
      return {
        ImportDeclaration: (node) => collect(node, node.source.value),
        ExportNamedDeclaration: (node) => collect(node, node.source?.value),
        ExportAllDeclaration: (node) => collect(node, node.source.value),
        ImportExpression: (node) => collect(node, node.source.value),
        CallExpression(node) {
          const [argument] = node.arguments;
          if (node.callee.type === "Identifier" && node.callee.name === "require" && argument?.type === "Literal") {
            collect(node, argument.value);
          }
        },
        // import foo = require("foo")
        TSExternalModuleReference: (node) => collect(node.parent, node.expression?.value),
        // type Foo = import("foo").Foo
        TSImportType: (node) => collect(node, node.argument?.literal?.value ?? node.source?.value),
        "Program:exit"() {
          for (const report of reports) {
            reportViolation(context, report, importNodes);
          }
        }
      };
    }
  };
}
function reportViolation(context, report, importNodes) {
  const comment = report.comment ?? DEFAULT_COMMENT;
  const firstLine = { loc: { line: 1, column: 0 } };
  if (report.at === "file") {
    context.report({
      ...firstLine,
      messageId: "module",
      data: { name: report.name, comment }
    });
    return;
  }
  const node = importNodes.get(report.specifier);
  const data = { name: report.name, source: report.specifier, comment };
  const location = node ? { node } : firstLine;
  if (report.cycle) {
    context.report({
      ...location,
      messageId: "cycle",
      data: { ...data, path: report.cycle.join(" -> ") }
    });
  } else {
    context.report({ ...location, messageId: "violation", data });
  }
}

// src/index.ts
var plugin = {
  meta: {
    name: "eslint-plugin-dependency-cruiser",
    version: "0.1.1"
  },
  rules: {
    errors: getDependencyCruiserRule("error"),
    warnings: getDependencyCruiserRule("warn")
  },
  configs: {},
  withGraphFingerprint
};
plugin.configs.all = {
  name: "dependency-cruiser/all",
  plugins: { "dependency-cruiser": plugin },
  rules: {
    "dependency-cruiser/errors": "error",
    "dependency-cruiser/warnings": "warn"
  }
};
var index_default = plugin;
export {
  index_default as default
};
