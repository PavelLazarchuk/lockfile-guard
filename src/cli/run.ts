import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { analyze, shouldFail, type Report } from '../analyze';
import { absolute, ConfigError, loadConfigFile, mergeConfig } from '../config';
import { contextFromEnv, GithubError, upsertStickyComment } from '../github/comment';
import { ParseError } from '../parsers/detect';
import { format } from '../reporters';
import { HELP, parseArgs, UsageError } from './args';

export type Io = {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    cwd: string;
    env: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
};

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_ERROR = 2;

export async function run(argv: readonly string[], io: Io): Promise<number> {
    try {
        return await execute(argv, io);
    } catch (error) {
        const expected =
            error instanceof UsageError ||
            error instanceof ConfigError ||
            error instanceof ParseError ||
            error instanceof GithubError;

        io.stderr(`lockfile-guard: ${error instanceof Error ? error.message : String(error)}\n`);
        if (!expected && error instanceof Error && error.stack !== undefined)
            io.stderr(`${error.stack}\n`);

        return EXIT_ERROR;
    }
}

async function execute(argv: readonly string[], io: Io): Promise<number> {
    const options = parseArgs(argv);

    if (options.help) {
        io.stdout(`${HELP}\n`);

        return EXIT_CLEAN;
    }
    if (options.version) {
        io.stdout(`${__CLI_VERSION__}\n`);

        return EXIT_CLEAN;
    }
    if (options.base === undefined || options.head === undefined)
        throw new UsageError('--base and --head are both required. Run with --help.');
    if (options.githubComment && options.format !== 'markdown')
        throw new UsageError('--github-comment needs --format markdown.');

    const fileConfig = await loadConfigFile(io.cwd, options.configPath);
    const config = mergeConfig(fileConfig, options.overrides);
    const basePath = absolute(io.cwd, options.base);
    const headPath = absolute(io.cwd, options.head);

    const report = await analyze({
        base: { source: await read(basePath), filename: basePath },
        head: { source: await read(headPath), filename: headPath },
        config,
        cwd: io.cwd,
    });

    const body = format(report, options.format, relative(io.cwd, headPath), __CLI_VERSION__);

    if (options.output === undefined) io.stdout(body);
    else await writeFile(absolute(io.cwd, options.output), body);

    if (options.githubComment) await comment(report, body, options, io);
    if (!options.quiet && options.output !== undefined)
        io.stderr(`lockfile-guard: wrote ${options.output}\n`);

    for (const warning of options.quiet ? [] : report.warnings)
        io.stderr(`lockfile-guard: registry lookup failed — ${warning}\n`);

    return shouldFail(report, config) ? EXIT_FINDINGS : EXIT_CLEAN;
}

async function comment(
    report: Report,
    body: string,
    options: { quiet: boolean },
    io: Io
): Promise<void> {
    const context = contextFromEnv(io.env);

    if (context === null) {
        io.stderr(
            'lockfile-guard: no GitHub context (GITHUB_TOKEN, GITHUB_REPOSITORY, PR number) — skipping the comment.\n'
        );

        return;
    }

    const result = await upsertStickyComment(context, body, io.fetchImpl, {
        createIfMissing: report.changes.length > 0,
    });

    if (options.quiet) return;
    if (result.action === 'skipped')
        io.stderr('lockfile-guard: no dependency changes — no comment posted.\n');
    else
        io.stderr(
            `lockfile-guard: ${result.action} comment ${result.id} (${report.findings.length} findings)\n`
        );
}

async function read(path: string): Promise<string> {
    try {
        return await readFile(path, 'utf8');
    } catch (error) {
        throw new ParseError(`Cannot read ${path}: ${(error as Error).message}`);
    }
}
