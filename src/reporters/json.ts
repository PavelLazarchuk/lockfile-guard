import type { Report } from '../analyze';

export function formatJson(report: Report): string {
    return `${JSON.stringify(
        {
            version: 1,
            summary: report.summary,
            lockfiles: report.lockfiles,
            findings: report.findings.map(finding => ({
                rule: finding.rule,
                severity: finding.severity,
                package: {
                    name: finding.pkg.name,
                    version: finding.pkg.version,
                    path: finding.pkg.path,
                },
                evidence: finding.evidence,
            })),
            warnings: report.warnings,
        },
        null,
        2
    )}\n`;
}
