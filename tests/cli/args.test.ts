import { describe, expect, it } from 'vitest';
import { HELP, parseArgs, UsageError } from '../../src/cli/args';

describe('parseArgs', () => {
    it('reads the documented invocation', () => {
        const options = parseArgs([
            '--base',
            'base-lock.json',
            '--head',
            'package-lock.json',
            '--format',
            'sarif',
            '--fail-on',
            'critical',
            '--output',
            'out.sarif',
        ]);

        expect(options).toMatchObject({
            base: 'base-lock.json',
            head: 'package-lock.json',
            format: 'sarif',
            output: 'out.sarif',
            overrides: { failOn: 'critical' },
        });
    });

    it('collects the repeatable options', () => {
        const options = parseArgs([
            '--registry',
            'https://npm.internal.example.com',
            '--registry',
            'https://registry.npmjs.org',
            '--ignore',
            '@my-org/**',
            '--ignore',
            'left-*',
        ]);

        expect(options.overrides.registries).toHaveLength(2);
        expect(options.overrides.ignore).toEqual(['@my-org/**', 'left-*']);
    });

    it('reads the boolean switches', () => {
        const options = parseArgs([
            '--offline',
            '--strict-age',
            '--no-cache',
            '--fail-on-network-error',
            '--github-comment',
            '--quiet',
        ]);

        expect(options.overrides).toMatchObject({
            offline: true,
            strictAge: true,
            cacheDir: false,
            failOnNetworkError: true,
        });
        expect(options).toMatchObject({ githubComment: true, quiet: true });
    });

    it('reads the numeric thresholds', () => {
        expect(
            parseArgs([
                '--freshness-hours',
                '48',
                '--min-weekly-downloads',
                '500',
                '--concurrency',
                '4',
                '--timeout',
                '1500',
                '--cache-dir',
                '/tmp/lfg',
            ]).overrides
        ).toMatchObject({
            freshnessHours: 48,
            minWeeklyDownloads: 500,
            concurrency: 4,
            timeoutMs: 1500,
            cacheDir: '/tmp/lfg',
        });
    });

    it('supports the short forms', () => {
        expect(parseArgs(['-h']).help).toBe(true);
        expect(parseArgs(['-v']).version).toBe(true);
        expect(parseArgs(['-o', 'out.md']).output).toBe('out.md');
    });

    it('defaults to markdown, no comment, no overrides', () => {
        expect(parseArgs([])).toEqual({
            format: 'markdown',
            githubComment: false,
            help: false,
            version: false,
            quiet: false,
            overrides: {},
        });
    });

    it.each([
        [['--format', 'yaml'], /--format must be markdown, json or sarif/],
        [['--fail-on', 'whenever'], /--fail-on must be/],
        [['--freshness-hours', 'soon'], /--freshness-hours needs a non-negative number/],
        [['--timeout', '0'], /--timeout needs a number of at least 1/],
        [['--concurrency', '0'], /--concurrency needs a number of at least 1/],
        [['--base'], /--base needs a value/],
        [['--base', '--head'], /--base needs a value/],
        [['--nonsense'], /Unknown option --nonsense/],
        [['package-lock.json'], /Unknown option package-lock.json/],
    ])('rejects %s', (argv, message) => {
        expect(() => parseArgs(argv)).toThrow(UsageError);
        expect(() => parseArgs(argv)).toThrow(message);
    });
});

describe('HELP', () => {
    it('documents every exit code and the required options', () => {
        expect(HELP).toContain('--base <file>');
        expect(HELP).toContain('Exit codes: 0 clean · 1 findings at or above --fail-on · 2');
    });
});
