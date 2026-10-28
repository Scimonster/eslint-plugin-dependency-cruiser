import type { ICruiseResult } from "dependency-cruiser";
import type { Report } from "./types";

/**
 * Turns a whole-graph cruise result into the reports for each file, keyed by
 * path relative to the cruise's base dir.
 *
 * Reads `modules[].rules` and `modules[].dependencies[].rules` rather than
 * `summary.violations`, because the summary keeps one violation per cycle
 * (deduplicated by node set), so most files in a cycle would get no report.
 * Baselined violations come back with severity `ignore` and are skipped.
 * Folder-scoped rules only appear in `summary` and `folders` and have no file
 * to report on, so they're skipped too.
 */
export function buildIndex(
  result: ICruiseResult,
  comments: Map<string, string | undefined>
): Map<string, Report[]> {
  const index = new Map<string, Report[]>();
  const push = (file: string, report: Report) => {
    let reports = index.get(file);
    if (!reports) {
      reports = [];
      index.set(file, reports);
    }
    reports.push(report);
  };

  for (const module of result.modules) {
    for (const rule of module.rules ?? []) {
      if (rule.severity === "ignore") {
        continue;
      }
      push(module.source, {
        name: rule.name,
        severity: rule.severity,
        comment: comments.get(rule.name),
        at: "file",
      });
    }
    for (const dependency of module.dependencies) {
      for (const rule of dependency.rules ?? []) {
        if (rule.severity === "ignore") {
          continue;
        }
        push(module.source, {
          name: rule.name,
          severity: rule.severity,
          comment: comments.get(rule.name),
          at: "import",
          specifier: dependency.module,
          ...(dependency.cycle
            ? {
                cycle: [
                  module.source,
                  ...dependency.cycle.map((step) => step.name),
                ],
              }
            : {}),
        });
      }
    }
  }
  return index;
}
