import { isIgnored, type Config } from '../config';
import { changedPackage, type Change, type EnrichedChange, type VersionMeta } from '../model';
import { createCache } from './cache';
import { registryFor, RegistryClient } from './client';
import { DOWNLOADS_API, weeklyDownloads } from './downloads';
import { hoursSince, resolveFirstPublishedAt, resolvePublishedAt } from './freshness';
import { mapLimit } from './limit';
import { loadAuth, type Auth } from './npmrc';
import { redactError } from './secrets';

export type Needs = {
    metadata: boolean;
    freshness: boolean;
    downloads: boolean;
    firstPublish: boolean;
};

export type EnrichResult = { changes: EnrichedChange[]; warnings: string[] };

export const NO_NEEDS: Needs = {
    metadata: false,
    freshness: false,
    downloads: false,
    firstPublish: false,
};

export async function createClient(config: Config, cwd = process.cwd()): Promise<RegistryClient> {
    const auth: Auth = await loadAuth(cwd);

    return new RegistryClient({
        registries: config.registries,
        timeoutMs: config.timeoutMs,
        cache: createCache(config.cacheDir),
        auth,
    });
}

/** Only these two kinds describe a package version that is new to the head lockfile. */
function needsLookup(change: Change): boolean {
    return change.kind === 'added' || change.kind === 'version-changed';
}

export async function enrich(
    changes: readonly Change[],
    config: Config,
    needs: Needs,
    client: RegistryClient,
    now = Date.now()
): Promise<EnrichResult> {
    const warnings: string[] = [];
    const wanted = Object.values(needs).some(Boolean);

    if (config.offline || !wanted)
        return { changes: changes.map(change => ({ change, base: null, head: null })), warnings };

    const enriched = await mapLimit(changes, config.concurrency, async change => {
        const pkg = changedPackage(change);

        if (!needsLookup(change) || isIgnored(pkg.name, config))
            return { change, base: null, head: null };

        const registry = registryFor(pkg, config.registries);
        // A resolution outside the allowlist is reported by `registry-mismatch`, never fetched.
        if (registry === null) return { change, base: null, head: null };

        try {
            // Independent documents — one round trip, not two.
            const [head, base] = await Promise.all([
                needs.metadata
                    ? client.versionMeta(registry, pkg.name, pkg.version)
                    : Promise.resolve<VersionMeta>({}),
                change.kind === 'version-changed' && needs.metadata
                    ? client.versionMeta(registry, change.from.name, change.from.version)
                    : Promise.resolve<VersionMeta | null>(null),
            ]);

            // The freshness ladder leans on endpoints a private registry may not implement at all.
            // Losing a date must not throw away the publisher and scripts we already hold.
            try {
                await datePackage(client, registry, change, head, needs, now);
            } catch (error) {
                warnings.push(`${pkg.name}@${pkg.version}: ${redactError(error, client.secrets)}`);
            }

            return { change, base, head };
        } catch (error) {
            const message = `${pkg.name}@${pkg.version}: ${redactError(error, client.secrets)}`;
            warnings.push(message);

            return { change, base: null, head: null, error: message };
        }
    });

    if (needs.downloads) await attachDownloads(enriched, config, client, warnings);

    return { changes: enriched, warnings: [...new Set(warnings)] };
}

async function datePackage(
    client: RegistryClient,
    registry: string,
    change: Change,
    head: VersionMeta,
    needs: Needs,
    now: number
): Promise<void> {
    const pkg = changedPackage(change);

    if (needs.freshness) {
        const publishedAt = await resolvePublishedAt(client, registry, pkg.name, pkg.version);

        // A clock skew that puts the publish in the future is not freshness data worth keeping.
        if (publishedAt !== undefined && (hoursSince(publishedAt, now) ?? -1) >= 0)
            head.publishedAt = publishedAt;
    }
    if (needs.firstPublish && change.kind === 'added' && !pkg.direct)
        head.firstPublishedAt = await resolveFirstPublishedAt(client, registry, pkg.name);
}

/** One batched request for every new transitive package, instead of a packument each. */
async function attachDownloads(
    enriched: EnrichedChange[],
    config: Config,
    client: RegistryClient,
    warnings: string[]
): Promise<void> {
    const candidates = enriched.filter(
        item =>
            item.change.kind === 'added' &&
            !item.change.pkg.direct &&
            item.head !== null &&
            !isIgnored(item.change.pkg.name, config)
    );

    if (candidates.length === 0) return;

    const names = candidates.map(item => changedPackage(item.change).name);

    try {
        const counts = await weeklyDownloads(
            client,
            names,
            config.concurrency,
            DOWNLOADS_API,
            error =>
                warnings.push(`download counts unavailable: ${redactError(error, client.secrets)}`)
        );

        for (const item of candidates) {
            const count = counts.get(changedPackage(item.change).name);

            if (count !== undefined && item.head !== null) item.head.weeklyDownloads = count;
        }
    } catch (error) {
        warnings.push(`download counts unavailable: ${redactError(error, client.secrets)}`);
    }
}

export { RegistryClient, RegistryError, registryFor } from './client';
export { createCache, DiskCache, NULL_CACHE } from './cache';
export { loadAuth, parseNpmrc } from './npmrc';
export { redact, redactError } from './secrets';
