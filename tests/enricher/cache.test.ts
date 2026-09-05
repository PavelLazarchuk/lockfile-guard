import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCache, DiskCache, NULL_CACHE } from '../../src/enricher/cache';

const url = 'https://registry.npmjs.org/left-pad/1.3.0';

describe('DiskCache', () => {
    it('round-trips an entry', async () => {
        const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'lfg-cache-')));
        const entry = { etag: 'W/"abc"', body: '{"ok":true}', fetchedAt: 1_700_000_000_000 };

        await cache.write(url, entry);

        expect(await cache.read(url)).toEqual(entry);
    });

    it('reads nothing for a URL it has never seen', async () => {
        const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'lfg-cache-')));

        expect(await cache.read(url)).toBeNull();
    });

    it('treats a corrupted entry as a miss', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'lfg-cache-'));
        const file = `${createHash('sha256').update(url).digest('hex')}.json`;

        await writeFile(join(dir, file), 'not json');
        expect(await new DiskCache(dir).read(url)).toBeNull();

        await writeFile(join(dir, file), '{"body":42}');
        expect(await new DiskCache(dir).read(url)).toBeNull();
    });

    it('swallows a directory it cannot write to', async () => {
        const file = join(await mkdtemp(join(tmpdir(), 'lfg-cache-')), 'a-file');
        await writeFile(file, 'in the way');

        await expect(
            new DiskCache(join(file, 'nested')).write(url, { body: '{}', fetchedAt: 0 })
        ).resolves.toBeUndefined();
    });
});

describe('createCache', () => {
    it('returns the no-op cache when caching is off', async () => {
        expect(createCache(false)).toBe(NULL_CACHE);
        await expect(NULL_CACHE.read(url)).resolves.toBeNull();
        await expect(NULL_CACHE.write(url, { body: '{}', fetchedAt: 0 })).resolves.toBeUndefined();
    });

    it('returns a disk cache for a path', () => {
        expect(createCache('/tmp/lfg')).toBeInstanceOf(DiskCache);
    });
});
