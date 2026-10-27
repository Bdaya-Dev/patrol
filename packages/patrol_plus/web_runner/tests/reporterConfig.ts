// Added by Bdaya-Dev — not present in the original LeanCode Patrol source. See NOTICE.md.
import * as path from "path"
import type { ReporterDescription } from "@playwright/test"

/**
 * The directory json/junit write into. Deliberately a SIBLING of
 * `outputFolder` (the html reporter's own folder), never nested inside it:
 * Playwright's html reporter clears/recreates `outputFolder` in its own
 * `onEnd()`, and reporters run their `onEnd()` in the order they're
 * registered in `reporter:`. If html isn't listed first, its clear step
 * wipes out whatever json/junit already wrote moments earlier into that
 * same folder. A sibling directory sidesteps the ordering dependency
 * entirely -- nothing else ever clears it.
 */
export function machineReportsDirFor(outputFolder: string): string {
  return `${outputFolder}-machine-reports`
}

export function mapReporters(
  reporterEnv: string,
  outputFolder: string,
  machineReportsDir: string,
): ReporterDescription[] {
  const reporterNames: unknown = JSON.parse(reporterEnv)

  if (!Array.isArray(reporterNames)) {
    throw new Error("PATROL_WEB_REPORTER must be a JSON array of reporter names")
  }

  return reporterNames.map(name => {
    switch (name) {
      case "html":
        return ["html", { outputFolder, open: "never" }] satisfies ReporterDescription
      case "json":
        // Not inside outputFolder -- see machineReportsDirFor's doc comment.
        return ["json", { outputFile: path.join(machineReportsDir, "results.json") }] satisfies ReporterDescription
      case "junit":
        return ["junit", { outputFile: path.join(machineReportsDir, "results.xml") }] satisfies ReporterDescription
      case "list":
      case "dot":
      case "line":
      case "github":
      case "null":
        return [name] satisfies ReporterDescription
      default:
        throw new Error(`Unsupported reporter: ${name}`)
    }
  })
}
