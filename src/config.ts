import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { isSeverity, type Severity } from './model';

export const CONFIG_FILENAME = 'lockfile-guard.config.json';

export type RuleSetting = Severity | 'off';

export type Config = {
    registries: string[];
    freshnessHours: number;
    minWeeklyDownloads: number;
    maxTransitiveAgeDays: number;
    ignore: string[];
    failOn: Severity | 'none';
    rules: Record<string, RuleSetting>;
    offline: boolean;
    strictAge: boolean;
    concurrency: number;
    timeoutMs: number;
    cacheDir: string | false;
    failOnNetworkError: boolean;
};

export const DEFAULT_CONFIG: Config = {
    registries: ['https://registry.npmjs.org'],
    freshnessHours: 24,
    minWeeklyDownloads: 100,
    maxTransitiveAgeDays: 30,
    ignore: [],
    failOn: 'high',
    rules: {},
    offline: false,
    strictAge: false,
    concurrency: 8,
    timeoutMs: 10_000,
    cacheDir: defaultCacheDir(),
    failOnNetworkError: false,
};

export class ConfigError extends Error {}

function defaultCacheDir(): string {
    const xdg = process.env.XDG_CACHE_HOME;
    if (xdg !== undefined && xdg !== '') return resolve(xdg, 'lockfile-guard');

    const home = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
    return resolve(home, '.cache', 'lockfile-guard');
}

export function stripJsonComments(source: string): string {
    let out = '';
    let inString = false;
    let inLine = false;
    let inBlock = false;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i] as string;
        const next = source[i + 1];

        if (inLine) {
            if (char === '\n') {
                inLine = false;
                out += char;
            }
            continue;
        }
        if (inBlock) {
            if (char === '*' && next === '/') {
                inBlock = false;
                i += 1;
            }
            continue;
        }
        if (inString) {
            out += char;
            if (char === '\\') {
                out += next ?? '';
                i += 1;
            } else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            out += char;
            continue;
        }
        if (char === '/' && next === '/') {
            inLine = true;
            i += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            inBlock = true;
            i += 1;
            continue;
        }
        out += char;
    }

    return out;
}

function asStringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
        throw new ConfigError(`${field} must be an array of strings.`);

    return value as string[];
}

function asPositiveNumber(value: unknown, field: string, minimum = 0): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum)
        throw new ConfigError(
            minimum === 0
                ? `${field} must be a non-negative number.`
                : `${field} must be at least ${minimum}.`
        );

    return value;
}

function asBoolean(value: unknown, field: string): boolean {
    if (typeof value !== 'boolean') throw new ConfigError(`${field} must be a boolean.`);

    return value;
}

/** Normalizes a registry to its origin, so `https://r.example.com/` and `.../` compare equal. */
export function registryOrigin(url: string): string | null {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

export function parseConfig(raw: unknown, from = CONFIG_FILENAME): Partial<Config> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new ConfigError(`${from} must contain a JSON object.`);

    const input = raw as Record<string, unknown>;
    const config: Partial<Config> = {};

    if (input.registries !== undefined) {
        const registries = asStringArray(input.registries, 'registries');

        for (const registry of registries)
            if (registryOrigin(registry) === null)
                throw new ConfigError(`registries contains an invalid URL: ${registry}`);

        config.registries = registries;
    }
    if (input.freshnessHours !== undefined)
        config.freshnessHours = asPositiveNumber(input.freshnessHours, 'freshnessHours');
    if (input.minWeeklyDownloads !== undefined)
        config.minWeeklyDownloads = asPositiveNumber(
            input.minWeeklyDownloads,
            'minWeeklyDownloads'
        );
    if (input.maxTransitiveAgeDays !== undefined)
        config.maxTransitiveAgeDays = asPositiveNumber(
            input.maxTransitiveAgeDays,
            'maxTransitiveAgeDays'
        );
    if (input.ignore !== undefined) config.ignore = asStringArray(input.ignore, 'ignore');
    if (input.failOn !== undefined) {
        if (!isSeverity(input.failOn) && input.failOn !== 'none')
            throw new ConfigError(
                `failOn must be one of critical, high, medium, low, none — got ${String(input.failOn)}.`
            );

        config.failOn = input.failOn;
    }
    if (input.rules !== undefined) {
        if (input.rules === null || typeof input.rules !== 'object' || Array.isArray(input.rules))
            throw new ConfigError('rules must be an object.');

        const rules: Record<string, RuleSetting> = {};

        for (const [id, setting] of Object.entries(input.rules as Record<string, unknown>)) {
            if (!isSeverity(setting) && setting !== 'off')
                throw new ConfigError(
                    `rules.${id} must be one of critical, high, medium, low, off — got ${String(setting)}.`
                );

            rules[id] = setting;
        }
        config.rules = rules;
    }
    if (input.offline !== undefined) config.offline = asBoolean(input.offline, 'offline');
    if (input.strictAge !== undefined) config.strictAge = asBoolean(input.strictAge, 'strictAge');
    if (input.failOnNetworkError !== undefined)
        config.failOnNetworkError = asBoolean(input.failOnNetworkError, 'failOnNetworkError');
    if (input.concurrency !== undefined)
        config.concurrency = asPositiveNumber(input.concurrency, 'concurrency', 1);
    if (input.timeoutMs !== undefined)
        config.timeoutMs = asPositiveNumber(input.timeoutMs, 'timeoutMs', 1);
    if (input.cacheDir !== undefined) {
        if (input.cacheDir !== false && typeof input.cacheDir !== 'string')
            throw new ConfigError('cacheDir must be a path or false.');

        config.cacheDir = input.cacheDir;
    }

    return config;
}

/**
 * Reads the config file if there is one. An explicit `--config` that does not exist is an error;
 * a missing file at the default location is not — zero configuration is the supported first run.
 */
export async function loadConfigFile(cwd: string, explicitPath?: string): Promise<Partial<Config>> {
    const path =
        explicitPath === undefined ? resolve(cwd, CONFIG_FILENAME) : absolute(cwd, explicitPath);

    let source: string;

    try {
        source = await readFile(path, 'utf8');
    } catch (error) {
        if (explicitPath !== undefined)
            throw new ConfigError(`Cannot read config file ${path}: ${(error as Error).message}`);

        return {};
    }

    let raw: unknown;

    try {
        raw = JSON.parse(stripJsonComments(source));
    } catch (error) {
        throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
    }

    return parseConfig(raw, path);
}

/** Resolves a user-supplied path against the working directory, leaving an absolute one alone. */
export function absolute(cwd: string, path: string): string {
    return isAbsolute(path) ? path : resolve(cwd, path);
}

export function mergeConfig(...layers: Partial<Config>[]): Config {
    return layers.reduce<Config>((merged, layer) => ({ ...merged, ...stripUndefined(layer) }), {
        ...DEFAULT_CONFIG,
    });
}

function stripUndefined(layer: Partial<Config>): Partial<Config> {
    return Object.fromEntries(
        Object.entries(layer).filter(([, value]) => value !== undefined)
    ) as Partial<Config>;
}

/**
 * Glob matching for package names only: `*` stops at a `/` so `@scope/*` cannot swallow a nested
 * path, `**` crosses it. That is the whole grammar — package names have no deeper structure.
 */
export function matchesGlob(name: string, pattern: string): boolean {
    const source = pattern
        .split('**')
        .map(part =>
            part
                .split('*')
                .map(chunk => chunk.replace(/[.+^${}()|[\]\\?]/g, '\\$&'))
                .join('[^/]*')
        )
        .join('.*');

    return new RegExp(`^${source}$`).test(name);
}

export function isIgnored(name: string, config: Config): boolean {
    return config.ignore.some(pattern => matchesGlob(name, pattern));
}
