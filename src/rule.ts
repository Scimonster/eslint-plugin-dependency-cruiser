import path from "node:path";

import type { Rule } from "eslint";
import type { SeverityType } from "dependency-cruiser";

import { callWorkerSync } from "./bridge";
import { isUnderRoots } from "./graph-cache";
import { toProjectRequest } from "./settings";
import type { PluginSettings, Report } from "./types";

const DEFAULT_COMMENT = "Import violates the import rules";

// Loosely typed, since the TypeScript nodes aren't part of ESTree's types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = Rule.Node & Record<string, any>;

export function getDependencyCruiserRule(
  severity: SeverityType
): Rule.RuleModule {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Report dependency rule violations of ${severity} severity, found by Dependency Cruiser`,
        recommended: true,
        url: "https://github.com/Scimonster/eslint-plugin-dependency-cruiser",
      },
      messages: {
        violation: "{{name}} ({{source}}): {{comment}}",
        cycle: "{{name}} ({{source}}): {{comment}} [{{path}}]",
        module: "{{name}}: {{comment}}",
      },
      schema: [],
    },
    create(context) {
      const settings: PluginSettings =
        context.settings["dependency-cruiser"] ?? {};
      const cwd = context.cwd;
      const file = context.physicalFilename;
      const project = toProjectRequest(cwd, settings);

      // Files outside the cruised folders have no reports; skip the worker
      if (!path.isAbsolute(file) || !isUnderRoots(cwd, project.roots, file)) {
        return {};
      }

      const reports = callWorkerSync(
        { kind: "reports", ...project, file },
        settings.timeout
      ).reports.filter((report) => report.severity === severity);

      if (reports.length === 0) {
        return {};
      }

      // The first node importing each specifier. A violation is reported once,
      // on that node, so counts stay stable however often a module is imported.
      const importNodes = new Map<string, Rule.Node>();
      const collect = (node: Rule.Node | null, source: unknown) => {
        if (node && typeof source === "string" && !importNodes.has(source)) {
          importNodes.set(source, node);
        }
      };

      return {
        ImportDeclaration: (node) => collect(node, node.source.value),
        ExportNamedDeclaration: (node) => collect(node, node.source?.value),
        ExportAllDeclaration: (node) => collect(node, node.source.value),
        ImportExpression: (node) =>
          collect(node, (node.source as AnyNode).value),
        CallExpression(node) {
          const [argument] = node.arguments as AnyNode[];
          if (
            node.callee.type === "Identifier" &&
            node.callee.name === "require" &&
            argument?.type === "Literal"
          ) {
            collect(node, argument.value);
          }
        },
        // import foo = require("foo")
        TSExternalModuleReference: (node: AnyNode) =>
          collect(node.parent, node.expression?.value),
        // type Foo = import("foo").Foo
        TSImportType: (node: AnyNode) =>
          collect(node, node.argument?.literal?.value ?? node.source?.value),

        "Program:exit"() {
          for (const report of reports) {
            reportViolation(context, report, importNodes);
          }
        },
      } as Rule.RuleListener;
    },
  };
}

function reportViolation(
  context: Rule.RuleContext,
  report: Report,
  importNodes: Map<string, Rule.Node>
) {
  const comment = report.comment ?? DEFAULT_COMMENT;
  // Module-level violations, and imports we can't find a node for (e.g. in
  // JSDoc or triple-slash directives), go on the first line
  const firstLine = { loc: { line: 1, column: 0 } };

  if (report.at === "file") {
    context.report({
      ...firstLine,
      messageId: "module",
      data: { name: report.name, comment },
    });
    return;
  }

  const node = importNodes.get(report.specifier!);
  const data = { name: report.name, source: report.specifier!, comment };
  const location = node ? { node } : firstLine;
  if (report.cycle) {
    // e.g. "no-circular (./b): ... [src/a.ts -> src/b.ts -> src/a.ts]"
    context.report({
      ...location,
      messageId: "cycle",
      data: { ...data, path: report.cycle.join(" -> ") },
    });
  } else {
    // e.g. "not-to-test (./my-file.test): Don't import test code from app code"
    context.report({ ...location, messageId: "violation", data });
  }
}
