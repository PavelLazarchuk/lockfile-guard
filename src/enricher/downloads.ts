import { mapLimit } from './limit';
import type { RegistryClient } from './client';

export const DOWNLOADS_API = 'https://api.npmjs.org';

/** The bulk endpoint takes up to 128 names, and rejects scoped ones — those go one at a time. */
const BULK_LIMIT = 128;

type BulkEntry = { downloads?: number } | null;

/**
 * "Nobody has ever downloaded this" answers the same question as "this package is brand new", at
 * 277 bytes for three packages instead of a packument each.
 */
export async function weeklyDownloads(
    client: RegistryClient,
    names: readonly string[],
    concurrency: number,
    api = DOWNLOADS_API,
    // Losing the counts costs one rule, not the run — but silence is what makes a degraded run look
    // like a clean one, so the caller is told and can turn it into a warning.
    onError?: (error: unknown) => void
): Promise<Map<string, number>> {
    const unique = [...new Set(names)];
    const scoped = unique.filter(name => name.startsWith('@'));
    const plain = unique.filter(name => !name.startsWith('@'));
    const batches: string[][] = scoped.map(name => [name]);

    for (let i = 0; i < plain.length; i += BULK_LIMIT) batches.push(plain.slice(i, i + BULK_LIMIT));

    const results = new Map<string, number>();
    const responses = await mapLimit(batches, concurrency, async batch => {
        const path = batch.map(name => encodeURIComponent(name)).join(',');

        try {
            return await client.fetchJson(`${api}/downloads/point/last-week/${path}`, 0);
        } catch (error) {
            onError?.(error);

            return null;
        }
    });

    for (const [index, response] of responses.entries())
        collect(batches[index] as string[], response, results);

    return results;
}

function collect(batch: string[], response: unknown, into: Map<string, number>): void {
    if (response === null || typeof response !== 'object') return;

    const single = response as { package?: unknown; downloads?: unknown };

    if (typeof single.package === 'string' && typeof single.downloads === 'number') {
        into.set(single.package, single.downloads);

        return;
    }
    for (const name of batch) {
        const entry = (response as Record<string, BulkEntry>)[name];

        if (entry != null && typeof entry.downloads === 'number') into.set(name, entry.downloads);
    }
}
