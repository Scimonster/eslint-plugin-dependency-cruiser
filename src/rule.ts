import type { Rule } from "eslint";
import type { SeverityType } from "dependency-cruiser";

import { cruiseFileSync } from "./bridge";
import type { PluginSettings } from "./types";

export function getDependencyCruiserRule(
  severity: SeverityType
): Rule.RuleModule {
  return {
    meta: {
      type: "problem",
      docs: {
        description: `Report import rule violations of ${severity} severity, found by Dependency Cruiser`,
        recommended: true,
        url: "https://github.com/Scimonster/eslint-plugin-dependency-cruiser",
      },
      messages: {
        violation: "{{name}} ({{source}}): {{comment}}",
      },
      schema: [],
    },
    create(context) {
      const settings: PluginSettings =
        context.settings["dependency-cruiser"] ?? {};

      // We run dependency cruiser with the options provided by the user via
      // configuration, for the current file only. Both rules (error and warn)
      // share one cruise per file, and filter its violations by severity.
      const { dependencies } = cruiseFileSync(
        {
          cwd: context.cwd,
          configPath: settings.config,
          knownViolationsPath:
            settings.knownViolations ?? settings.knownViolationsFile,
          file: context.physicalFilename,
        },
        context.sourceCode.text,
        settings.timeout
      );

      if (dependencies.length === 0) {
        return {};
      }

      return {
        // This method is ran by ESLint for every import declaration in the current file
        ImportDeclaration(node) {
          // The source of the import, e.g. for "import foo from './bar'" this will be "./bar"
          const importSource = node.source.value;
          if (typeof importSource !== "string") {
            return;
          }

          const dependency = dependencies.find(
            (dep) => dep.module === importSource
          );
          if (!dependency) {
            return;
          }

          for (const violation of dependency.rules) {
            // Violations ignored via the baseline file come back from DC with
            // severity "ignore", so they never match.
            if (violation.severity !== severity) {
              continue;
            }

            // e.g. "not-to-test (./my-file.test): Don't import test code from app code"
            context.report({
              node,
              messageId: "violation",
              data: {
                name: violation.name,
                source: importSource,
                comment: violation.comment ?? "Import violates the import rules",
              },
            });
          }
        },
      };
    },
  };
}
