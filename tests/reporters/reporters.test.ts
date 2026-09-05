import { describe, expect, it } from 'vitest';
import { analyze, type Report } from '../../src/analyze';
import { format, formatJson, formatMarkdown, formatSarif, isFormat } from '../../src/reporters';
import { STICKY_MARKER, topSeverity } from '../../src/reporters/markdown';
import { config, fixture } from '../helpers';

const base = { source: fixture('npm/base.package-lock.json'), filename: 'package-lock.json' };
const head = { source: fixture('npm/head.package-lock.json'), filename: 'package-lock.json' };

async function offlineReport(): Promise<Report> {
    return analyze({ base, head, config: config({ offline: true }) });
}

function withFindings(report: Report, extra: Partial<Report>): Report {
    return { ...report, ...extra };
}

describe('formatMarkdown', () => {
    it('renders a full report', async () => {
        expect(formatMarkdown(await offlineReport())).toMatchSnapshot();
    });

    it('renders every severity, plus warnings', async () => {
        const report = await offlineReport();
        const [first] = report.findings;

        expect(
            formatMarkdown(
                withFindings(report, {
                    findings: [
                        {
                            ...first!,
                            rule: 'install-script-added',
                            severity: 'high',
                            evidence: 'postinstall: curl x | sh',
                        },
                        { ...first!, severity: 'critical' },
                        { ...first!, rule: 'version-too-fresh', severity: 'medium' },
                        { ...first!, rule: 'deprecated', severity: 'low' },
                    ],
                    warnings: ['left-pad@1.3.0: 503 Service Unavailable'],
                })
            )
        ).toMatchSnapshot();
    });

    it('says so when nothing changed at all', async () => {
        const report = await analyze({ base, head: base, config: config({ offline: true }) });

        expect(formatMarkdown(report)).toContain('No dependency changes in this pull request.');
        expect(formatMarkdown(report)).toContain(STICKY_MARKER);
    });

    it('says so when changes are clean', async () => {
        const report = withFindings(await offlineReport(), { findings: [] });

        expect(formatMarkdown(report)).toContain('nothing suspicious');
    });

    it('uses the singular for a single finding and a single change', async () => {
        const report = await offlineReport();
        const single = withFindings(report, {
            findings: [report.findings[0]!],
            changes: [report.changes[0]!],
        });

        expect(formatMarkdown(single)).toContain('**1 finding** across 1 dependency change');
    });
});

describe('topSeverity', () => {
    it('reports the worst severity present', async () => {
        const report = await offlineReport();

        expect(topSeverity(report.findings)).toBe('critical');
        expect(topSeverity([])).toBeNull();
    });
});

describe('formatJson', () => {
    it('renders a stable document', async () => {
        expect(formatJson(await offlineReport())).toMatchSnapshot();
    });
});

describe('formatSarif', () => {
    it('renders a Code Scanning document', async () => {
        expect(
            formatSarif(await offlineReport(), './package-lock.json', '1.2.3')
        ).toMatchSnapshot();
    });

    it('normalizes a Windows path into a repository-relative URI', async () => {
        const sarif = JSON.parse(
            formatSarif(await offlineReport(), 'packages\\api\\package-lock.json')
        );

        expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
            'packages/api/package-lock.json'
        );
    });
});

describe('format', () => {
    it('dispatches on the requested kind', async () => {
        const report = await offlineReport();

        expect(format(report, 'markdown', 'package-lock.json', '1.0.0')).toContain(STICKY_MARKER);
        expect(JSON.parse(format(report, 'json', 'package-lock.json', '1.0.0')).version).toBe(1);
        expect(JSON.parse(format(report, 'sarif', 'package-lock.json', '1.0.0')).version).toBe(
            '2.1.0'
        );
    });

    it('knows which format names exist', () => {
        expect(isFormat('sarif')).toBe(true);
        expect(isFormat('yaml')).toBe(false);
    });
});
