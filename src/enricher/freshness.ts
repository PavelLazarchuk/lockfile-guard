import { encodeName, RegistryClient } from './client';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Publish dates live in the packument, which is megabytes for a popular package — so they are
 * reached by a ladder instead: 19 bytes of dist-tags, then a 1 KB search hit when the bumped
 * version is `latest` (the usual case), and only otherwise the full document.
 */
export async function resolvePublishedAt(
    client: RegistryClient,
    registry: string,
    name: string,
    version: string
): Promise<string | undefined> {
    const latest = await distTagLatest(client, registry, name);

    if (latest === version) {
        const fromSearch = await searchDate(client, registry, name);
        if (fromSearch !== undefined) return fromSearch;
    }

    const time = await packumentTime(client, registry, name);
    const published = time[version];

    return typeof published === 'string' ? published : undefined;
}

/** The very first publish of a package — only in the packument, so only asked for under strictAge. */
export async function resolveFirstPublishedAt(
    client: RegistryClient,
    registry: string,
    name: string
): Promise<string | undefined> {
    const created = (await packumentTime(client, registry, name)).created;

    return typeof created === 'string' ? created : undefined;
}

async function distTagLatest(
    client: RegistryClient,
    registry: string,
    name: string
): Promise<string | undefined> {
    const url = `${registry}/-/package/${encodeName(name)}/dist-tags`;
    const tags = await client.fetchJson(url, HOUR_MS);
    const latest = (tags as Record<string, unknown> | null)?.latest;

    return typeof latest === 'string' ? latest : undefined;
}

type SearchResponse = { objects?: { package?: { name?: string; date?: string } }[] };

async function searchDate(
    client: RegistryClient,
    registry: string,
    name: string
): Promise<string | undefined> {
    const url = `${registry}/-/v1/search?text=${encodeURIComponent(name)}&size=1`;
    const response = (await client.fetchJson(url, HOUR_MS)) as SearchResponse | null;
    const hit = response?.objects?.[0]?.package;

    // Search is a ranking, not a lookup — a near miss for another package must not date this one.
    return hit?.name === name && typeof hit.date === 'string' ? hit.date : undefined;
}

async function packumentTime(
    client: RegistryClient,
    registry: string,
    name: string
): Promise<Record<string, unknown>> {
    const url = `${registry}/${encodeName(name)}`;
    const packument = (await client.fetchJson(url, HOUR_MS)) as { time?: unknown } | null;
    const time = packument?.time;

    return time !== null && typeof time === 'object' ? (time as Record<string, unknown>) : {};
}

export function hoursSince(iso: string, now: number): number | undefined {
    const published = Date.parse(iso);

    return Number.isNaN(published) ? undefined : (now - published) / HOUR_MS;
}
