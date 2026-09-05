import { afterEach, describe, expect, it } from 'vitest';
import { RegistryClient } from '../../src/enricher/client';
import { DOWNLOADS_API } from '../../src/enricher/downloads';
import { createClient, enrich, NO_NEEDS, type Needs } from '../../src/enricher';
import type { Change } from '../../src/model';
import { config, pkg } from '../helpers';
import { mockRegistry } from './registry';

const NPM = 'https://registry.npmjs.org';

let restore = () => {};

afterEach(() => restore());

function client() {
    return new RegistryClient({ registries: [NPM], timeoutMs: 5_000 });
}

function needs(overrides: Partial<Needs> = {}): Needs {
    return { ...NO_NEEDS, metadata: true, ...overrides };
}

const bump: Change = {
    kind: 'version-changed',
    from: pkg({ name: 'esbuild', version: '0.24.0' }),
    to: pkg({
        name: 'esbuild',
        version: '0.25.0',
        resolved: `${NPM}/esbuild/-/esbuild-0.25.0.tgz`,
    }),
};

describe('createClient', () => {
    it('builds a client from the config and the .npmrc next to it', async () => {
        const built = await createClient(config({ registries: [NPM] }), process.cwd());

        expect(built.defaultRegistry).toBe(NPM);
    });
});

describe('enrich', () => {
    it('asks for both sides of a bump', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry
            .intercept({ path: '/esbuild/0.25.0' })
            .reply(200, { _npmUser: { name: 'attacker' } });
        registry.intercept({ path: '/esbuild/0.24.0' }).reply(200, { _npmUser: { name: 'evanw' } });

        const result = await enrich([bump], config(), needs(), client());

        expect(result.changes[0]).toMatchObject({
            base: { npmUser: 'evanw' },
            head: { npmUser: 'attacker' },
        });
        expect(result.warnings).toEqual([]);
    });

    it('makes no request at all when offline or when no rule wants metadata', async () => {
        const mock = mockRegistry();
        restore = mock.restore;

        const offline = await enrich([bump], config({ offline: true }), needs(), client());
        const unwanted = await enrich([bump], config(), NO_NEEDS, client());

        expect(offline.changes[0]).toEqual({ change: bump, base: null, head: null });
        expect(unwanted.changes[0]).toEqual({ change: bump, base: null, head: null });
    });

    it('skips removals, ignored names and resolutions off the allowlist', async () => {
        const mock = mockRegistry();
        restore = mock.restore;

        const changes: Change[] = [
            { kind: 'removed', pkg: pkg({ name: 'left-pad' }) },
            { kind: 'added', pkg: pkg({ name: '@my-org/tool' }) },
            {
                kind: 'added',
                pkg: pkg({ name: 'evil', resolved: 'https://evil.example.com/x.tgz' }),
            },
        ];

        const result = await enrich(changes, config({ ignore: ['@my-org/**'] }), needs(), client());

        expect(result.changes.every(change => change.head === null)).toBe(true);
    });

    it('turns an unreachable registry into a warning, not a failure', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry.intercept({ path: '/esbuild/0.25.0' }).reply(503, 'down');
        registry.intercept({ path: '/esbuild/0.24.0' }).reply(200, {});

        const result = await enrich([bump], config(), needs(), client());

        expect(result.changes[0]?.error).toMatch(/esbuild@0\.25\.0: 503/);
        expect(result.warnings).toHaveLength(1);
    });

    it('dates a version through the freshness ladder', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry.intercept({ path: '/esbuild/0.25.0' }).reply(200, {});
        registry.intercept({ path: '/esbuild/0.24.0' }).reply(200, {});
        registry
            .intercept({ path: '/-/package/esbuild/dist-tags' })
            .reply(200, { latest: '0.25.0' });
        registry.intercept({ path: '/-/v1/search?text=esbuild&size=1' }).reply(200, {
            objects: [{ package: { name: 'esbuild', date: '2026-09-04T00:00:00Z' } }],
        });

        const now = Date.parse('2026-09-04T06:00:00Z');
        const result = await enrich([bump], config(), needs({ freshness: true }), client(), now);

        expect(result.changes[0]?.head?.publishedAt).toBe('2026-09-04T00:00:00Z');
    });

    it('drops a publish date that is in the future of the run', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry.intercept({ path: '/esbuild/0.25.0' }).reply(200, {});
        registry.intercept({ path: '/esbuild/0.24.0' }).reply(200, {});
        registry
            .intercept({ path: '/-/package/esbuild/dist-tags' })
            .reply(200, { latest: '0.25.0' });
        registry.intercept({ path: '/-/v1/search?text=esbuild&size=1' }).reply(200, {
            objects: [{ package: { name: 'esbuild', date: '2026-09-05T00:00:00Z' } }],
        });

        const now = Date.parse('2026-09-04T06:00:00Z');
        const result = await enrich([bump], config(), needs({ freshness: true }), client(), now);

        expect(result.changes[0]?.head?.publishedAt).toBeUndefined();
    });

    it('keeps the metadata it already has when the freshness ladder fails', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry
            .intercept({ path: '/esbuild/0.25.0' })
            .reply(200, { _npmUser: { name: 'attacker' } });
        registry.intercept({ path: '/esbuild/0.24.0' }).reply(200, { _npmUser: { name: 'evanw' } });
        // A private registry that does not implement dist-tags must not cost us the publisher.
        registry.intercept({ path: '/-/package/esbuild/dist-tags' }).reply(404, 'nope');

        const result = await enrich([bump], config(), needs({ freshness: true }), client());

        expect(result.changes[0]).toMatchObject({
            base: { npmUser: 'evanw' },
            head: { npmUser: 'attacker' },
        });
        expect(result.changes[0]?.head?.publishedAt).toBeUndefined();
        expect(result.warnings).toHaveLength(1);
    });

    it('warns when the download counts cannot be fetched', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const added: Change = {
            kind: 'added',
            pkg: pkg({ name: 'obscure-helper', direct: false }),
        };

        mock.agent.get(NPM).intercept({ path: '/obscure-helper/1.3.0' }).reply(200, {});
        mock.agent
            .get(DOWNLOADS_API)
            .intercept({ path: '/downloads/point/last-week/obscure-helper' })
            .reply(503, 'down');

        const result = await enrich([added], config(), needs({ downloads: true }), client());

        expect(result.changes[0]?.head?.weeklyDownloads).toBeUndefined();
        expect(result.warnings.join('')).toContain('download counts unavailable');
    });

    it('batches download counts for the new transitives', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const added: Change = {
            kind: 'added',
            pkg: pkg({ name: 'obscure-helper', direct: false }),
        };
        const direct: Change = { kind: 'added', pkg: pkg({ name: 'left-pad', direct: true }) };

        mock.agent.get(NPM).intercept({ path: '/obscure-helper/1.3.0' }).reply(200, {});
        mock.agent.get(NPM).intercept({ path: '/left-pad/1.3.0' }).reply(200, {});
        mock.agent
            .get(DOWNLOADS_API)
            .intercept({ path: '/downloads/point/last-week/obscure-helper' })
            .reply(200, { downloads: 3, package: 'obscure-helper' });

        const result = await enrich(
            [added, direct],
            config(),
            needs({ downloads: true }),
            client()
        );

        expect(result.changes[0]?.head?.weeklyDownloads).toBe(3);
        expect(result.changes[1]?.head?.weeklyDownloads).toBeUndefined();
        mock.agent.assertNoPendingInterceptors();
    });

    it('asks for the first publish date only under strict age', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const added: Change = {
            kind: 'added',
            pkg: pkg({ name: 'obscure-helper', direct: false }),
        };

        mock.agent.get(NPM).intercept({ path: '/obscure-helper/1.3.0' }).reply(200, {});
        mock.agent
            .get(NPM)
            .intercept({ path: '/obscure-helper' })
            .reply(200, { time: { created: '2026-09-01T00:00:00Z' } });

        const result = await enrich([added], config(), needs({ firstPublish: true }), client());

        expect(result.changes[0]?.head?.firstPublishedAt).toBe('2026-09-01T00:00:00Z');
    });

    it('does not ask for metadata a rule never reads', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const added: Change = {
            kind: 'added',
            pkg: pkg({ name: 'obscure-helper', direct: false }),
        };

        mock.agent
            .get(DOWNLOADS_API)
            .intercept({ path: '/downloads/point/last-week/obscure-helper' })
            .reply(200, { downloads: 3, package: 'obscure-helper' });

        const result = await enrich([added], config(), { ...NO_NEEDS, downloads: true }, client());

        expect(result.changes[0]?.head).toEqual({ weeklyDownloads: 3 });
        mock.agent.assertNoPendingInterceptors();
    });
});
