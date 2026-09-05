import { afterEach, describe, expect, it } from 'vitest';
import { RegistryClient } from '../../src/enricher/client';
import { DOWNLOADS_API, weeklyDownloads } from '../../src/enricher/downloads';
import { mockRegistry } from './registry';

let restore = () => {};

afterEach(() => restore());

function client() {
    return new RegistryClient({ registries: ['https://registry.npmjs.org'], timeoutMs: 5_000 });
}

describe('weeklyDownloads', () => {
    it('asks for the unscoped names in one request', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get(DOWNLOADS_API)
            .intercept({ path: '/downloads/point/last-week/left-pad,tiny-helper' })
            .reply(200, { 'left-pad': { downloads: 4_000_000 }, 'tiny-helper': null });

        expect([
            ...(await weeklyDownloads(client(), ['left-pad', 'tiny-helper', 'left-pad'], 4)),
        ]).toEqual([['left-pad', 4_000_000]]);
    });

    it('asks for a scoped name on its own, where the answer has another shape', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get(DOWNLOADS_API)
            .intercept({ path: '/downloads/point/last-week/%40scope%2Ftiny' })
            .reply(200, { downloads: 12, package: '@scope/tiny' });

        expect((await weeklyDownloads(client(), ['@scope/tiny'], 4)).get('@scope/tiny')).toBe(12);
    });

    it('splits a long list into batches of 128', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const names = Array.from({ length: 130 }, (_, i) => `pkg-${i}`);
        const api = mock.agent.get(DOWNLOADS_API);

        api.intercept({
            path: `/downloads/point/last-week/${names.slice(0, 128).join(',')}`,
        }).reply(200, { 'pkg-0': { downloads: 1 } });
        api.intercept({
            path: `/downloads/point/last-week/${names.slice(128).join(',')}`,
        }).reply(200, { 'pkg-128': { downloads: 2 } });

        const counts = await weeklyDownloads(client(), names, 4);

        expect(counts.get('pkg-0')).toBe(1);
        expect(counts.get('pkg-128')).toBe(2);
        mock.agent.assertNoPendingInterceptors();
    });

    it('gives up quietly when the downloads API is down', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get(DOWNLOADS_API)
            .intercept({ path: '/downloads/point/last-week/left-pad' })
            .reply(500, 'boom');

        expect(await weeklyDownloads(client(), ['left-pad'], 4)).toEqual(new Map());
    });

    it('ignores an answer that is not a shape it knows', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get(DOWNLOADS_API)
            .intercept({ path: '/downloads/point/last-week/left-pad' })
            .reply(200, '"surprise"');

        expect(await weeklyDownloads(client(), ['left-pad'], 4)).toEqual(new Map());
    });
});
