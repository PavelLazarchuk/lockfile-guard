import type { Config } from '../config';
import { isSeverity } from '../model';
import { isFormat, type Format } from '../reporters';

export type Options = {
    base?: string;
    head?: string;
    format: Format;
    output?: string;
    configPath?: string;
    githubComment: boolean;
    help: boolean;
    version: boolean;
    quiet: boolean;
    overrides: Partial<Config>;
};

export class UsageError extends Error {}

const VALUE_FLAGS = new Set([
    '--base',
    '--head',
    '--format',
    '--output',
    '-o',
    '--config',
    '--fail-on',
    '--registry',
    '--ignore',
    '--freshness-hours',
    '--min-weekly-downloads',
    '--concurrency',
    '--timeout',
    '--cache-dir',
]);

export function parseArgs(argv: readonly string[]): Options {
    const options: Options = {
        format: 'markdown',
        githubComment: false,
        help: false,
        version: false,
        quiet: false,
        overrides: {},
    };
    const registries: string[] = [];
    const ignore: string[] = [];

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] as string;
        const takesValue = VALUE_FLAGS.has(arg);
        const value = takesValue ? next(argv, i, arg) : '';

        if (takesValue) i += 1;

        switch (arg) {
            case '--base':
                options.base = value;
                break;
            case '--head':
                options.head = value;
                break;
            case '--format':
                if (!isFormat(value))
                    throw new UsageError(
                        `--format must be markdown, json or sarif — got ${value}.`
                    );
                options.format = value;
                break;
            case '--output':
            case '-o':
                options.output = value;
                break;
            case '--config':
                options.configPath = value;
                break;
            case '--fail-on':
                if (!isSeverity(value) && value !== 'none')
                    throw new UsageError(
                        `--fail-on must be critical, high, medium, low or none — got ${value}.`
                    );
                options.overrides.failOn = value;
                break;
            case '--registry':
                registries.push(value);
                break;
            case '--ignore':
                ignore.push(value);
                break;
            case '--freshness-hours':
                options.overrides.freshnessHours = number(value, arg);
                break;
            case '--min-weekly-downloads':
                options.overrides.minWeeklyDownloads = number(value, arg);
                break;
            case '--concurrency':
                options.overrides.concurrency = number(value, arg, 1);
                break;
            case '--timeout':
                options.overrides.timeoutMs = number(value, arg, 1);
                break;
            case '--cache-dir':
                options.overrides.cacheDir = value;
                break;
            case '--offline':
                options.overrides.offline = true;
                break;
            case '--strict-age':
                options.overrides.strictAge = true;
                break;
            case '--no-cache':
                options.overrides.cacheDir = false;
                break;
            case '--fail-on-network-error':
                options.overrides.failOnNetworkError = true;
                break;
            case '--github-comment':
                options.githubComment = true;
                break;
            case '--quiet':
                options.quiet = true;
                break;
            case '--help':
            case '-h':
                options.help = true;
                break;
            case '--version':
            case '-v':
                options.version = true;
                break;
            default:
                throw new UsageError(`Unknown option ${arg}. Run with --help.`);
        }
    }
    if (registries.length > 0) options.overrides.registries = registries;
    if (ignore.length > 0) options.overrides.ignore = ignore;

    return options;
}

function next(argv: readonly string[], index: number, flag: string): string {
    const value = argv[index + 1];

    if (value === undefined || value.startsWith('-'))
        throw new UsageError(`${flag} needs a value.`);

    return value;
}

function number(value: string, flag: string, minimum = 0): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed < minimum)
        throw new UsageError(
            minimum === 0
                ? `${flag} needs a non-negative number — got ${value}.`
                : `${flag} needs a number of at least ${minimum} — got ${value}.`
        );

    return parsed;
}

export const HELP = `lockfile-guard — diff two lockfiles and report supply-chain risk.

Usage:
  lockfile-guard --base <file> --head <file> [options]

Required:
  --base <file>              Lockfile from the target branch
  --head <file>              Lockfile from the pull request

Output:
  --format <kind>            markdown (default), json, sarif
  -o, --output <file>        Write the report to a file instead of stdout
  --github-comment           Post or update the sticky pull-request comment
  --quiet                    Print nothing but the report

Behaviour:
  --fail-on <severity>       critical, high (default), medium, low, none
  --offline                  Skip every rule that needs the registry
  --strict-age               Also date new transitives via the packument
  --registry <url>           Allowlist a registry (repeatable)
  --ignore <glob>            Ignore packages by name (repeatable)
  --freshness-hours <n>      version-too-fresh threshold (default 24)
  --min-weekly-downloads <n> new-obscure-transitive threshold (default 100)
  --concurrency <n>          Parallel registry requests (default 8)
  --timeout <ms>             Per-request timeout (default 10000)
  --cache-dir <path>         Override the ETag cache location
  --no-cache                 Do not read or write the ETag cache
  --fail-on-network-error    Treat registry failures as a failed run
  --config <file>            Config file (default lockfile-guard.config.json)

  -h, --help                 Show this help
  -v, --version              Show the version

Exit codes: 0 clean · 1 findings at or above --fail-on · 2 the run itself failed.`;
