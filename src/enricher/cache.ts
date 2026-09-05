import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CacheEntry = { etag?: string; body: string; fetchedAt: number };

export interface Cache {
    read(url: string): Promise<CacheEntry | null>;
    write(url: string, entry: CacheEntry): Promise<void>;
}

export const NULL_CACHE: Cache = {
    read: async () => null,
    write: async () => {},
};

/**
 * A version document never changes, so the cache could live forever; `deprecated` is the one field
 * that gets rewritten in place, which is why entries are revalidated with an ETag rather than
 * trusted blindly. Every failure here is swallowed — a broken cache must not fail a CI run.
 */
export class DiskCache implements Cache {
    constructor(private readonly dir: string) {}

    private file(url: string): string {
        return join(this.dir, `${createHash('sha256').update(url).digest('hex')}.json`);
    }

    async read(url: string): Promise<CacheEntry | null> {
        try {
            const raw = JSON.parse(await readFile(this.file(url), 'utf8')) as CacheEntry;

            return typeof raw?.body === 'string' ? raw : null;
        } catch {
            return null;
        }
    }

    async write(url: string, entry: CacheEntry): Promise<void> {
        try {
            await mkdir(this.dir, { recursive: true });
            await writeFile(this.file(url), JSON.stringify(entry));
        } catch {
            // Read-only or full disk — the run continues without a cache.
        }
    }
}

export function createCache(dir: string | false): Cache {
    return dir === false ? NULL_CACHE : new DiskCache(dir);
}
