import { parse as parseYaml } from 'yaml';
import type { Lockfile, Package } from '../model';
import { ParseError } from './errors';

type Resolution = { integrity?: string; tarball?: string; type?: string };

type PnpmEntry = { resolution?: Resolution; dev?: boolean };

type Importer = {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
};

type PnpmLock = {
    lockfileVersion?: unknown;
    packages?: Record<string, PnpmEntry>;
    importers?: Record<string, Importer>;
} & Importer;

/**
 * Three key grammars have shipped: `/foo/1.2.3_peer@1` (v5), `/foo@1.2.3(peer@1)` (v6) and
 * `foo@1.2.3(peer@1)` (v9). Peer suffixes are noise for our purposes and are dropped.
 */
export function parsePnpmKey(key: string): { name: string; version: string } | null {
    const withoutPeers = (key.startsWith('/') ? key.slice(1) : key).split('(')[0] as string;
    const segments = withoutPeers.split('/');
    const last = segments[segments.length - 1] as string;

    // v5 puts the version in its own path segment; a scoped name keeps its single slash.
    const isLegacy = segments.length > 1 && /^\d/.test(last) && !withoutPeers.startsWith('@');
    const isLegacyScoped = segments.length > 2 && /^\d/.test(last);

    if (isLegacy || isLegacyScoped)
        return { name: segments.slice(0, -1).join('/'), version: stripPeerSuffix(last) };

    const at = withoutPeers.lastIndexOf('@');
    if (at <= 0) return null;

    return {
        name: withoutPeers.slice(0, at),
        version: stripPeerSuffix(withoutPeers.slice(at + 1)),
    };
}

function stripPeerSuffix(version: string): string {
    return version.split('_')[0] as string;
}

function namesIn(importer: Importer | undefined): string[] {
    if (importer === undefined) return [];

    return [
        ...Object.keys(importer.dependencies ?? {}),
        ...Object.keys(importer.devDependencies ?? {}),
        ...Object.keys(importer.optionalDependencies ?? {}),
    ];
}

export function parsePnpmLock(source: string, filename = 'pnpm-lock.yaml'): Lockfile {
    let raw: unknown;

    try {
        raw = parseYaml(source);
    } catch (error) {
        throw new ParseError(`${filename} is not valid YAML: ${(error as Error).message}`);
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
        throw new ParseError(`${filename} must contain a YAML mapping.`);

    const lock = raw as PnpmLock;

    if (lock.lockfileVersion === undefined)
        throw new ParseError(`${filename} has no lockfileVersion — is it a lockfile?`);

    const importers = Object.values(lock.importers ?? {});
    // Single-package projects keep the root importer inline instead of under `importers`.
    const roots = importers.length > 0 ? importers : [lock];
    const direct = new Set(roots.flatMap(namesIn));
    const devOnly = new Set(
        roots
            .flatMap(importer => Object.keys(importer.devDependencies ?? {}))
            .filter(name => !isRuntimeDependency(roots, name))
    );

    const packages: Package[] = [];

    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
        const parsed = parsePnpmKey(key);
        if (parsed === null) continue;

        const resolution = entry?.resolution ?? {};

        packages.push({
            name: parsed.name,
            version: parsed.version,
            ...(resolution.tarball === undefined ? {} : { resolved: resolution.tarball }),
            ...(resolution.integrity === undefined ? {} : { integrity: resolution.integrity }),
            // v5 and v6 record dev-ness per entry; v9 dropped it, leaving only the importers.
            dev: entry?.dev === true || (entry?.dev === undefined && devOnly.has(parsed.name)),
            direct: direct.has(parsed.name),
            path: key,
        });
    }

    return { kind: 'pnpm', lockfileVersion: String(lock.lockfileVersion), packages };
}

function isRuntimeDependency(roots: Importer[], name: string): boolean {
    return roots.some(
        importer =>
            importer.dependencies?.[name] !== undefined ||
            importer.optionalDependencies?.[name] !== undefined
    );
}
