import type { Report } from '../analyze';
import { compareSeverity, SEVERITIES, type Finding, type Severity } from '../model';

export const STICKY_MARKER = '<!-- lockfile-guard -->';

const HEADINGS: Record<Severity, string> = {
    critical: '🛑 critical',
    high: '🔴 high',
    medium: '🟠 medium',
    low: '⚪ low',
};

export function formatMarkdown(report: Report): string {
    const lines = [STICKY_MARKER, '', '## 🔒 lockfile-guard', '', summaryLine(report), ''];

    for (const severity of SEVERITIES) {
        const findings = report.findings.filter(finding => finding.severity === severity);
        if (findings.length === 0) continue;

        lines.push(`### ${HEADINGS[severity]}`, '');
        lines.push('| Package | Rule | Evidence |', '| --- | --- | --- |');

        for (const finding of findings) lines.push(row(finding));

        lines.push('');
    }
    if (report.warnings.length > 0) {
        lines.push('> [!NOTE]', '> Some registry lookups failed, so network rules may be partial:');

        for (const warning of report.warnings) lines.push(`> - ${escapeCell(warning)}`);

        lines.push('');
    }
    lines.push(changesBlock(report), '');

    return lines.join('\n');
}

function summaryLine(report: Report): string {
    const { findings, changes } = report;

    if (changes.length === 0) return 'No dependency changes in this pull request.';
    if (findings.length === 0)
        return `Reviewed **${changes.length}** dependency ${plural(changes.length, 'change')} — nothing suspicious.`;

    const counts = SEVERITIES.map(
        severity =>
            [severity, findings.filter(finding => finding.severity === severity).length] as const
    )
        .filter(([, count]) => count > 0)
        .map(([severity, count]) => `${count} ${severity}`)
        .join(', ');

    return `**${findings.length} ${plural(findings.length, 'finding')}** across ${changes.length} dependency ${plural(changes.length, 'change')} — ${counts}.`;
}

function row(finding: Finding): string {
    const { pkg } = finding;

    return `| \`${pkg.name}@${pkg.version}\` | ${finding.rule} | ${escapeCell(finding.evidence)} |`;
}

function changesBlock(report: Report): string {
    const { summary } = report;
    const parts = [
        `${summary.added} added`,
        `${summary['version-changed']} updated`,
        `${summary.removed} removed`,
        `${summary['resolution-changed']} re-resolved`,
        `${summary['integrity-changed']} integrity-changed`,
    ];

    return `<sub>${parts.join(' · ')} · ${summary.packages} ${plural(summary.packages, 'package')} in the head lockfile (${report.lockfiles.kind} v${report.lockfiles.head})</sub>`;
}

/**
 * Evidence quotes install scripts verbatim, and those come from the registry — from a package an
 * attacker may well own. A `|` breaks the table, `<` opens raw HTML in a GitHub comment and a
 * backtick opens a code span that swallows the rest of the row, so none of them survives as markup.
 */
function escapeCell(text: string): string {
    return text
        .replace(/\|/g, '\\|')
        .replace(/`/g, '\\`')
        .replace(/</g, '&lt;')
        .replace(/\r\n?|\n/g, ' ');
}

function plural(count: number, word: string): string {
    return count === 1 ? word : `${word}s`;
}

export function topSeverity(findings: readonly Finding[]): Severity | null {
    return findings.reduce<Severity | null>(
        (top, finding) =>
            top === null || compareSeverity(finding.severity, top) < 0 ? finding.severity : top,
        null
    );
}
