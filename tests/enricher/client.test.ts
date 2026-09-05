import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiskCache } from '../../src/enricher/cache';
import {
    encodeName,
    RegistryClient,
    RegistryError,
    registryFor,
    toVersionMeta,
} from '../../src/enricher/client';
import { parseNpmrc } from '../../src/enricher/npmrc';
import { pkg } from '../helpers';
import { mockRegistry } from './registry';

const NPM = 'https://registry.npmjs.org';

const VERSION_DOC = {
    name: 'esbuild',
    version: '0.25.0',
    scripts: { postinstall: 'node install.js' },
    _npmUser: { name: 'evanw' },
    maintainers: [{ name: 'evanw' }, { name: 'kzc' }],
    dist: { integrity: 'sha512-x==', tarball: `${NPM}/esbuild/-/esbuild-0.25.0.tgz` },
};

let restore = () => {};

afterEach(() => restore());

function client(overrides: Partial<ConstructorParameters<typeof RegistryClient>[0]> = {}) {
    return new RegistryClient({ registries: [NPM], timeoutMs: 5_000, ...overrides });
}

describe('RegistryClient', () => {
    it('reads a version document into the fields the rules use', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent.get(NPM).intercept({ path: '/esbuild/0.25.0' }).reply(200, VERSION_DOC);

        expect(await client().versionMeta(NPM, 'esbuild', '0.25.0')).toEqual({
            scripts: { postinstall: 'node install.js' },
            npmUser: 'evanw',
            maintainers: ['evanw', 'kzc'],
        });
    });

    it('sends the .npmrc credential for the host it belongs to', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get('https://registry.example.com')
            .intercept({
                path: '/private-pkg/1.0.0',
                headers: { authorization: 'Bearer npm_privatetoken' },
            })
            .reply(200, { name: 'private-pkg' });

        const auth = parseNpmrc('//registry.example.com/:_authToken=npm_privatetoken');

        await expect(
            client({ registries: ['https://registry.example.com'], auth }).versionMeta(
                'https://registry.example.com',
                'private-pkg',
                '1.0.0'
            )
        ).resolves.toEqual({});
        mock.agent.assertNoPendingInterceptors();
    });

    it('keeps a private token out of the error it raises', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get('https://registry.example.com')
            .intercept({ path: '/private-pkg/1.0.0' })
            .reply(500, 'boom');

        const auth = parseNpmrc('//registry.example.com/:_authToken=npm_privatetoken');
        const failing = client({ registries: ['https://registry.example.com'], auth });
        const error = await failing
            .versionMeta('https://registry.example.com', 'private-pkg', '1.0.0')
            .catch((thrown: Error) => thrown);

        expect(error).toBeInstanceOf(RegistryError);
        expect((error as Error).message).not.toContain('npm_privatetoken');
        expect((error as Error).message).toMatch(/500/);
    });

    it('asks once for a URL two callers want at the same time', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent.get(NPM).intercept({ path: '/esbuild/0.25.0' }).reply(200, VERSION_DOC);

        const shared = client();

        await Promise.all([
            shared.versionMeta(NPM, 'esbuild', '0.25.0'),
            shared.versionMeta(NPM, 'esbuild', '0.25.0'),
        ]);
        mock.agent.assertNoPendingInterceptors();
    });

    it('serves a fresh cache entry without touching the network', async () => {
        const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'lfg-client-')));
        const first = mockRegistry();
        restore = first.restore;
        first.agent
            .get(NPM)
            .intercept({ path: '/esbuild/0.25.0' })
            .reply(200, VERSION_DOC, { headers: { etag: 'W/"v1"' } });

        await client({ cache }).versionMeta(NPM, 'esbuild', '0.25.0');
        first.restore();

        // A second client, so nothing is served from the in-flight map — and no interceptor at all.
        const second = mockRegistry();
        restore = second.restore;

        expect(await client({ cache }).versionMeta(NPM, 'esbuild', '0.25.0')).toMatchObject({
            npmUser: 'evanw',
        });
    });

    it('revalidates a stale entry with its ETag and reuses the body on 304', async () => {
        const cache = new DiskCache(await mkdtemp(join(tmpdir(), 'lfg-client-')));
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry
            .intercept({ path: '/esbuild/0.25.0' })
            .reply(200, VERSION_DOC, { headers: { etag: 'W/"v1"' } });
        registry
            .intercept({ path: '/esbuild/0.25.0', headers: { 'if-none-match': 'W/"v1"' } })
            .reply(304, '');

        const shared = client({ cache });

        await shared.fetchJson(`${NPM}/esbuild/0.25.0`, 0);

        expect(await client({ cache }).fetchJson(`${NPM}/esbuild/0.25.0`, 0)).toMatchObject({
            version: '0.25.0',
        });
        mock.agent.assertNoPendingInterceptors();
    });

    it('turns a body that is not JSON into a registry error', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent.get(NPM).intercept({ path: '/left-pad/1.3.0' }).reply(200, '<html>nope</html>');

        await expect(client().fetchJson(`${NPM}/left-pad/1.3.0`)).rejects.toThrow(
            /did not answer with JSON/
        );
    });

    it('reports a connection failure instead of throwing a raw fetch error', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get(NPM)
            .intercept({ path: '/left-pad/1.3.0' })
            .replyWithError(new Error('connect ECONNREFUSED'));

        await expect(client().fetchJson(`${NPM}/left-pad/1.3.0`)).rejects.toBeInstanceOf(
            RegistryError
        );
    });

    it('exposes the default registry and the secrets to scrub', () => {
        expect(client().defaultRegistry).toBe(NPM);
        expect(client({ registries: [] }).defaultRegistry).toBe(NPM);
        expect(
            client({ auth: parseNpmrc('//a.example/:_authToken=npm_x1234567') }).secrets
        ).toEqual(['npm_x1234567']);
        expect(client().secrets).toEqual([]);
    });
});

describe('encodeName', () => {
    it('escapes each segment but keeps the scope separator', () => {
        expect(encodeName('@scope/name')).toBe('%40scope/name');
        expect(encodeName('left-pad')).toBe('left-pad');
    });
});

describe('toVersionMeta', () => {
    it('accepts maintainers written as plain strings', () => {
        expect(toVersionMeta({ maintainers: ['b', 'a', 42] }).maintainers).toEqual(['a', 'b']);
    });

    it('normalizes the two shapes of deprecated', () => {
        expect(toVersionMeta({ deprecated: 'use v2' }).deprecated).toBe('use v2');
        expect(toVersionMeta({ deprecated: true }).deprecated).toBe('deprecated');
        expect(toVersionMeta({ deprecated: false }).deprecated).toBeUndefined();
    });

    it('refuses a document that is not an object', () => {
        expect(() => toVersionMeta('nope')).toThrow(RegistryError);
    });
});

describe('a registry served under a path prefix', () => {
    const ARTIFACTORY = 'https://art.example.com/artifactory/api/npm/npm-local';

    it('is requested where it lives, with the credential keyed by that path', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        mock.agent
            .get('https://art.example.com')
            .intercept({
                path: '/artifactory/api/npm/npm-local/left-pad/1.3.0',
                headers: { authorization: 'Bearer npm_artifactorytoken' },
            })
            .reply(200, { _npmUser: { name: 'ci-bot' } });

        const auth = parseNpmrc(
            '//art.example.com/artifactory/api/npm/npm-local/:_authToken=npm_artifactorytoken'
        );
        const resolved = `${ARTIFACTORY}/left-pad/-/left-pad-1.3.0.tgz`;
        const registry = registryFor(pkg({ resolved }), [ARTIFACTORY]);

        expect(registry).toBe(ARTIFACTORY);
        expect(
            await client({ registries: [ARTIFACTORY], auth }).versionMeta(
                registry!,
                'left-pad',
                '1.3.0'
            )
        ).toEqual({ npmUser: 'ci-bot' });
        mock.agent.assertNoPendingInterceptors();
    });

    it('is not reached by a token issued for a sibling path on the same host', () => {
        expect(
            registryFor(pkg({ resolved: `${ARTIFACTORY}-other/left-pad/-/left-pad-1.3.0.tgz` }), [
                ARTIFACTORY,
            ])
        ).toBeNull();
    });
});

describe('registryFor', () => {
    it.each([
        [pkg({ resolved: undefined }), NPM],
        [pkg({ resolved: `${NPM}/left-pad/-/left-pad-1.3.0.tgz` }), NPM],
        [pkg({ resolved: 'https://evil.example.com/x.tgz' }), null],
        [pkg({ resolved: 'git+ssh://git@github.com/a/b.git#sha' }), null],
        [pkg({ resolved: 'not a url' }), null],
    ])('decides where %s may be looked up', (input, expected) => {
        expect(registryFor(input, [NPM])).toBe(expected);
    });

    it('has nowhere to ask when no registry is configured', () => {
        expect(registryFor(pkg({ resolved: undefined }), [])).toBeNull();
        expect(registryFor(pkg({ resolved: undefined }), ['not a url'])).toBeNull();
    });
});
