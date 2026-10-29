"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => index_default
});
module.exports = __toCommonJS(index_exports);

// node_modules/tsup/assets/cjs_shims.js
var getImportMetaUrl = () => typeof document === "undefined" ? new URL(`file:${__filename}`).href : document.currentScript && document.currentScript.tagName.toUpperCase() === "SCRIPT" ? document.currentScript.src : new URL("main.js", document.baseURI).href;
var importMetaUrl = /* @__PURE__ */ getImportMetaUrl();

// src/fingerprint.ts
var import_node_crypto = require("crypto");
var import_node_worker_threads = require("worker_threads");

// src/bridge.ts
var import_synckit = require("synckit");
var DEFAULT_TIMEOUT = 6e4;
var worker;
function callWorkerSync(request, timeout = DEFAULT_TIMEOUT) {
  if (!worker) {
    worker = (0, import_synckit.createSyncFn)(
      new URL("./worker.mjs", importMetaUrl),
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
  const envKey = `ESLINT_PLUGIN_DEPENDENCY_CRUISER_GRAPH_${(0, import_node_crypto.createHash)("sha1").update(projectKey(request)).digest("hex").slice(0, 12)}`;
  let graph = import_node_worker_threads.isMainThread ? void 0 : process.env[envKey];
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
var import_node_path3 = __toESM(require("path"));

// src/graph-cache.ts
var import_node_crypto2 = require("crypto");
var import_node_fs2 = __toESM(require("fs"));
var import_node_path2 = __toESM(require("path"));

// src/project.ts
var import_node_fs = __toESM(require("fs"));
var import_node_path = __toESM(require("path"));
var import_json5 = __toESM(require("json5"));

// src/graph-cache.ts
function isUnderRoots(cwd, roots, absoluteFile) {
  return roots.some((root) => {
    const relative = import_node_path2.default.relative(import_node_path2.default.resolve(cwd, root), absoluteFile);
    return !relative.startsWith("..") && !import_node_path2.default.isAbsolute(relative);
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
      if (!import_node_path3.default.isAbsolute(file) || !isUnderRoots(cwd, project.roots, file)) {
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
module.exports = module.exports.default;
