import type { Package, VersionMeta } from '../model';
import { isAllowedRegistry, isHttpUrl, normalizeAll, resolutionRegistry } from '../registries';
import { NULL_CACHE, type Cache } from './cache';
import { authorizationFor, EMPTY_AUTH, type Auth } from './npmrc';
import { redactError } from './secrets';

export type ClientOptions = {
    registries: string[];
    timeoutMs: number;
    auth?: Auth;
    cache?: Cache;
    ttlMs?: number;
    fetchImpl?: typeof fetch;
};

export class RegistryError extends Error {}

const DAY_MS = 24 * 60 * 60 * 1000;

export class RegistryClient {
    private readonly inflight = new Map<string, Promise<unknown>>();

    constructor(private readonly options: ClientOptions) {}

    get defaultRegistry(): string {
        return this.options.registries[0] ?? 'https://registry.npmjs.org';
    }

    get secrets(): readonly string[] {
        return this.options.auth?.secrets ?? [];
    }

    /**
     * One request per URL per run, cached on disk between runs. `ttlMs: 0` forces revalidation,
     * which is what the mutable endpoints (dist-tags, search, downloads) want.
     */
    async fetchJson(url: string, ttlMs = this.options.ttlMs ?? DAY_MS): Promise<unknown> {
        const pending = this.inflight.get(url);
        if (pending !== undefined) return pending;

        const promise = this.request(url, ttlMs);
        this.inflight.set(url, promise);

        return promise;
    }

    private async request(url: string, ttlMs: number): Promise<unknown> {
        const cache = this.options.cache ?? NULL_CACHE;
        const cached = await cache.read(url);

        if (cached !== null && Date.now() - cached.fetchedAt < ttlMs)
            return parse(cached.body, url);

        const auth = this.options.auth ?? EMPTY_AUTH;
        const authorization = authorizationFor(url, auth);
        const doFetch = this.options.fetchImpl ?? globalThis.fetch;
        const headers: Record<string, string> = { accept: 'application/json' };

        if (authorization !== undefined) headers.authorization = authorization;
        if (cached?.etag !== undefined) headers['if-none-match'] = cached.etag;

        let response: Response;

        try {
            response = await doFetch(url, {
                headers,
                signal: AbortSignal.timeout(this.options.timeoutMs),
            });
        } catch (error) {
            throw new RegistryError(redactError(error, auth.secrets));
        }

        if (response.status === 304 && cached !== null) {
            await cache.write(url, { ...cached, fetchedAt: Date.now() });

            return parse(cached.body, url);
        }
        if (!response.ok)
            throw new RegistryError(
                `${response.status} ${response.statusText} for ${safeUrl(url)}`
            );

        const body = await response.text();
        const etag = response.headers.get('etag');

        await cache.write(url, {
            ...(etag === null ? {} : { etag }),
            body,
            fetchedAt: Date.now(),
        });

        return parse(body, url);
    }

    async versionMeta(registry: string, name: string, version: string): Promise<VersionMeta> {
        const url = `${registry}/${encodeName(name)}/${encodeURIComponent(version)}`;

        return toVersionMeta(await this.fetchJson(url));
    }
}

/** Scoped names keep their slash — the registry accepts it, and it keeps URLs readable in errors. */
export function encodeName(name: string): string {
    return name
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

function parse(body: string, url: string): unknown {
    try {
        return JSON.parse(body);
    } catch {
        throw new RegistryError(`${safeUrl(url)} did not answer with JSON.`);
    }
}

/** URLs are built by us, never by a lockfile, but credentials can still ride in one. */
function safeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.username = '';
        parsed.password = '';
        parsed.search = '';

        return parsed.toString();
    } catch {
        return '(url withheld)';
    }
}

type RawVersion = {
    scripts?: Record<string, string>;
    _npmUser?: { name?: string };
    maintainers?: ({ name?: string } | string)[];
    deprecated?: string | boolean;
};

export function toVersionMeta(raw: unknown): VersionMeta {
    if (raw === null || typeof raw !== 'object')
        throw new RegistryError('Registry answered with something that is not a version document.');

    const doc = raw as RawVersion;
    const meta: VersionMeta = {};

    if (doc.scripts !== null && typeof doc.scripts === 'object') meta.scripts = doc.scripts;
    if (typeof doc._npmUser?.name === 'string') meta.npmUser = doc._npmUser.name;
    if (Array.isArray(doc.maintainers))
        meta.maintainers = doc.maintainers
            .map(maintainer => (typeof maintainer === 'string' ? maintainer : maintainer?.name))
            .filter((name): name is string => typeof name === 'string')
            .sort();
    if (typeof doc.deprecated === 'string') meta.deprecated = doc.deprecated;
    else if (doc.deprecated === true) meta.deprecated = 'deprecated';

    return meta;
}

/**
 * Which registry, if any, may be asked about this package — the one the tarball itself came from,
 * so a path-prefixed private registry is requested where it lives and matches its `.npmrc` entry.
 * A resolution that is not allowlisted is a finding in its own right (`registry-mismatch`) and
 * never a request.
 */
export function registryFor(pkg: Package, registries: readonly string[]): string | null {
    const allowed = normalizeAll(registries).filter(isHttpUrl);

    if (pkg.resolved === undefined) return allowed[0] ?? null;

    const registry = resolutionRegistry(pkg.resolved, pkg.name);

    if (registry === null || !isHttpUrl(registry)) return null;

    return isAllowedRegistry(registry, allowed) ? registry : null;
}
