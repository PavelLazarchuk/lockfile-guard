import { afterEach, describe, expect, it } from 'vitest';
import { RegistryClient } from '../../src/enricher/client';
import {
    hoursSince,
    resolveFirstPublishedAt,
    resolvePublishedAt,
} from '../../src/enricher/freshness';
import { mockRegistry } from './registry';

const NPM = 'https://registry.npmjs.org';

let restore = () => {};

afterEach(() => restore());

function client() {
    return new RegistryClient({ registries: [NPM], timeoutMs: 5_000 });
}

describe('resolvePublishedAt', () => {
    it('stops at the search hit when the bumped version is latest', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry
            .intercept({ path: '/-/package/esbuild/dist-tags' })
            .reply(200, { latest: '0.25.0' });
        registry.intercept({ path: '/-/v1/search?text=esbuild&size=1' }).reply(200, {
            objects: [{ package: { name: 'esbuild', date: '2026-09-01T10:00:00Z' } }],
        });

        expect(await resolvePublishedAt(client(), NPM, 'esbuild', '0.25.0')).toBe(
            '2026-09-01T10:00:00Z'
        );
        mock.agent.assertNoPendingInterceptors();
    });

    it('pays for the packument only when the version is not latest', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry
            .intercept({ path: '/-/package/esbuild/dist-tags' })
            .reply(200, { latest: '0.26.0' });
        registry
            .intercept({ path: '/esbuild' })
            .reply(200, { time: { '0.25.0': '2026-08-01T10:00:00Z' } });

        expect(await resolvePublishedAt(client(), NPM, 'esbuild', '0.25.0')).toBe(
            '2026-08-01T10:00:00Z'
        );
    });

    it('does not date a package from another package that ranked higher', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry.intercept({ path: '/-/package/tiny/dist-tags' }).reply(200, { latest: '2.0.0' });
        registry
            .intercept({ path: '/-/v1/search?text=tiny&size=1' })
            .reply(200, { objects: [{ package: { name: 'tiny-other', date: '2026-01-01' } }] });
        registry.intercept({ path: '/tiny' }).reply(200, { time: { '2.0.0': '2025-01-01' } });

        expect(await resolvePublishedAt(client(), NPM, 'tiny', '2.0.0')).toBe('2025-01-01');
    });

    it('returns nothing when neither step can date the version', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry.intercept({ path: '/-/package/tiny/dist-tags' }).reply(200, {});
        registry.intercept({ path: '/tiny' }).reply(200, { name: 'tiny' });

        expect(await resolvePublishedAt(client(), NPM, 'tiny', '2.0.0')).toBeUndefined();
    });

    it('propagates a registry failure so the caller can degrade', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent.get(NPM).intercept({ path: '/-/package/tiny/dist-tags' }).reply(503, 'nope');

        await expect(resolvePublishedAt(client(), NPM, 'tiny', '2.0.0')).rejects.toThrow(/503/);
    });
});

describe('resolveFirstPublishedAt', () => {
    it('reads time.created out of the packument', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get(NPM)
            .intercept({ path: '/obscure-helper' })
            .reply(200, { time: { created: '2026-08-30T00:00:00Z' } });

        expect(await resolveFirstPublishedAt(client(), NPM, 'obscure-helper')).toBe(
            '2026-08-30T00:00:00Z'
        );
    });

    it('copes with a packument that has no time at all', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent.get(NPM).intercept({ path: '/obscure-helper' }).reply(200, { time: 'nonsense' });

        expect(await resolveFirstPublishedAt(client(), NPM, 'obscure-helper')).toBeUndefined();
    });
});

describe('hoursSince', () => {
    it('measures against the supplied clock', () => {
        const now = Date.parse('2026-09-04T12:00:00Z');

        expect(hoursSince('2026-09-04T06:00:00Z', now)).toBe(6);
        expect(hoursSince('not a date', now)).toBeUndefined();
    });
});
