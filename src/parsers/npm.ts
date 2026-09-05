import type { Lockfile, Package } from '../model';
import { ParseError } from './errors';

type LockEntry = {
    name?: string;
    version?: string;
    resolved?: string;
    integrity?: string;
    link?: boolean;
    dev?: boolean;
    devOptional?: boolean;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
};

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/** `node_modules/a/node_modules/@scope/b` names `@scope/b` — everything before the last hop is context. */
export function packageNameFromPath(path: string): string {
    const marker = path.lastIndexOf('node_modules/');

    return marker === -1 ? path : path.slice(marker + 'node_modules/'.length);
}

/**
 * A key that never enters `node_modules` is a workspace directory, and its mirror under
 * `node_modules` carries `link: true`. Neither is fetched from a registry, so neither is diffed —
 * but both declare dependencies, which is how `direct` is decided.
 */
function isInstalledPackage(path: string, entry: LockEntry): boolean {
    return path.startsWith('node_modules/') && entry.link !== true;
}

export function parseNpmLock(source: string, filename = 'package-lock.json'): Lockfile {
    let raw: unknown;

    try {
        raw = JSON.parse(source);
    } catch (error) {
        throw new ParseError(`${filename} is not valid JSON: ${(error as Error).message}`);
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new ParseError(`${filename} must contain a JSON object.`);

    const lock = raw as { lockfileVersion?: unknown; packages?: unknown };
    const version = lock.lockfileVersion;

    if (typeof version !== 'number')
        throw new ParseError(`${filename} has no numeric lockfileVersion — is it a lockfile?`);
    if (version < 2)
        throw new ParseError(
            `${filename} is lockfileVersion ${version}. lockfile-guard needs 2 or 3 — run \`npm install\` with npm 7+ to upgrade it.`
        );
    if (lock.packages === null || typeof lock.packages !== 'object' || Array.isArray(lock.packages))
        throw new ParseError(
            `${filename} has no "packages" map, which lockfileVersion 2 and 3 require.`
        );

    const entries = Object.entries(lock.packages as Record<string, LockEntry>);
    const direct = new Set<string>();

    for (const [path, entry] of entries) {
        if (isInstalledPackage(path, entry)) continue;

        for (const field of DEPENDENCY_FIELDS)
            for (const name of Object.keys(entry[field] ?? {})) direct.add(name);
    }

    const packages: Package[] = [];

    for (const [path, entry] of entries) {
        if (!isInstalledPackage(path, entry)) continue;
        if (typeof entry.version !== 'string') continue;

        const name = entry.name ?? packageNameFromPath(path);

        packages.push({
            name,
            version: entry.version,
            ...(entry.resolved === undefined ? {} : { resolved: entry.resolved }),
            ...(entry.integrity === undefined ? {} : { integrity: entry.integrity }),
            dev: entry.dev === true || entry.devOptional === true,
            direct: direct.has(name),
            path,
        });
    }

    return { kind: 'npm', lockfileVersion: String(version), packages };
}
