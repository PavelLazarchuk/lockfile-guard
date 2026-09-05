import type { Report } from '../analyze';
import { formatJson } from './json';
import { formatMarkdown } from './markdown';
import { formatSarif } from './sarif';

export const FORMATS = ['markdown', 'json', 'sarif'] as const;

export type Format = (typeof FORMATS)[number];

export function isFormat(value: string): value is Format {
    return (FORMATS as readonly string[]).includes(value);
}

export function format(report: Report, kind: Format, headPath: string, version: string): string {
    if (kind === 'json') return formatJson(report);
    if (kind === 'sarif') return formatSarif(report, headPath, version);

    return formatMarkdown(report);
}

export { formatJson } from './json';
export { formatMarkdown, STICKY_MARKER, topSeverity } from './markdown';
export { formatSarif } from './sarif';
