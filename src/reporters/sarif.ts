import type { Report } from '../analyze';
import type { Severity } from '../model';
import { RULES } from '../rules';

const LEVELS: Record<Severity, string> = {
    critical: 'error',
    high: 'error',
    medium: 'warning',
    low: 'note',
};

/**
 * SARIF is what turns this from a PR comment into a Code Scanning alert. Every finding points at
 * the head lockfile — the line is not meaningful, but GitHub requires a location.
 */
export function formatSarif(report: Report, headPath: string, version = '0.0.0'): string {
    const sarif = {
        $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
        version: '2.1.0',
        runs: [
            {
                tool: {
                    driver: {
                        name: 'lockfile-guard',
                        informationUri: 'https://github.com/PavelLazarchuk/lockfile-guard',
                        version,
                        rules: RULES.map(rule => ({
                            id: rule.id,
                            name: rule.id,
                            shortDescription: { text: rule.description },
                            defaultConfiguration: { level: LEVELS[rule.severity] },
                            properties: { tags: ['supply-chain', 'security'] },
                        })),
                    },
                },
                results: report.findings.map(finding => ({
                    ruleId: finding.rule,
                    level: LEVELS[finding.severity],
                    message: {
                        text: `${finding.pkg.name}@${finding.pkg.version}: ${finding.evidence}`,
                    },
                    locations: [
                        {
                            physicalLocation: {
                                artifactLocation: { uri: toUri(headPath) },
                                region: { startLine: 1 },
                            },
                        },
                    ],
                    partialFingerprints: {
                        packageVersionRule: `${finding.rule}:${finding.pkg.name}@${finding.pkg.version}`,
                    },
                })),
            },
        ],
    };

    return `${JSON.stringify(sarif, null, 2)}\n`;
}

function toUri(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '');
}
