import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, type Config } from '../src/config';
import type { EnrichedChange, Package, VersionMeta } from '../src/model';

export function fixture(name: string): string {
    return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
}

export function config(overrides: Partial<Config> = {}): Config {
    return { ...DEFAULT_CONFIG, cacheDir: false, ...overrides };
}

export function pkg(overrides: Partial<Package> = {}): Package {
    const name = overrides.name ?? 'left-pad';

    return {
        name,
        version: '1.3.0',
        resolved: `https://registry.npmjs.org/${name}/-/${name}-1.3.0.tgz`,
        integrity: 'sha512-abc==',
        dev: false,
        direct: true,
        path: `node_modules/${name}`,
        ...overrides,
    };
}

export function added(
    overrides: Partial<Package> = {},
    head: VersionMeta | null = {}
): EnrichedChange {
    return { change: { kind: 'added', pkg: pkg(overrides) }, base: null, head };
}

export function bumped(
    from: Partial<Package>,
    to: Partial<Package>,
    base: VersionMeta | null = {},
    head: VersionMeta | null = {}
): EnrichedChange {
    return { change: { kind: 'version-changed', from: pkg(from), to: pkg(to) }, base, head };
}
