import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authorizationFor, loadAuth, parseNpmrc } from '../../src/enricher/npmrc';

const originalEnv = { ...process.env };

afterEach(() => {
    process.env = { ...originalEnv };
});

describe('parseNpmrc', () => {
    it('reads the two forms that authenticate a GET', () => {
        const auth = parseNpmrc(
            [
                '; a comment',
                '# another',
                'registry=https://registry.example.com',
                '//registry.example.com/:_authToken=npm_tokenvalue1',
                '//other.example.com/:_auth=YmFzZTY0dmFsdWU=',
                '//third.example.com/:username=someone',
            ].join('\n')
        );

        expect(auth.credentials).toEqual([
            { prefix: '//registry.example.com/', header: 'Bearer npm_tokenvalue1' },
            { prefix: '//other.example.com/', header: 'Basic YmFzZTY0dmFsdWU=' },
        ]);
        expect(auth.secrets).toContain('someone');
    });

    it('expands an environment variable and drops the line when it is unset', () => {
        process.env.LFG_TEST_TOKEN = 'npm_fromenvironment';

        expect(parseNpmrc('//a.example.com/:_authToken=${LFG_TEST_TOKEN}').credentials).toEqual([
            { prefix: '//a.example.com/', header: 'Bearer npm_fromenvironment' },
        ]);
        expect(parseNpmrc('//a.example.com/:_authToken=${LFG_MISSING}').credentials).toEqual([]);
    });

    it('strips quotes and skips empty values', () => {
        expect(parseNpmrc('//a.example.com/:_authToken="npm_quoted"').credentials[0]?.header).toBe(
            'Bearer npm_quoted'
        );
        expect(parseNpmrc('//a.example.com/:_authToken=').credentials).toEqual([]);
    });
});

describe('authorizationFor', () => {
    const auth = parseNpmrc(
        [
            '//registry.example.com/:_authToken=npm_rootlevel',
            '//registry.example.com/scoped/:_authToken=npm_scopedvalue',
        ].join('\n')
    );

    it('prefers the longest matching prefix, as npm does', () => {
        expect(authorizationFor('https://registry.example.com/scoped/pkg/1.0.0', auth)).toBe(
            'Bearer npm_scopedvalue'
        );
        expect(authorizationFor('https://registry.example.com/pkg/1.0.0', auth)).toBe(
            'Bearer npm_rootlevel'
        );
    });

    it('stops a prefix at a path boundary, so a sibling path gets no token', () => {
        expect(authorizationFor('https://registry.example.com/scopedother/pkg', auth)).toBe(
            'Bearer npm_rootlevel'
        );
    });

    it('sends nothing to a host it has no credential for', () => {
        expect(authorizationFor('https://registry.npmjs.org/pkg', auth)).toBeUndefined();
        expect(authorizationFor('not a url', auth)).toBeUndefined();
    });
});

describe('loadAuth', () => {
    it('lets the project .npmrc win over the home one', async () => {
        const home = await mkdtemp(join(tmpdir(), 'lfg-home-'));
        const project = await mkdtemp(join(tmpdir(), 'lfg-project-'));

        await writeFile(join(home, '.npmrc'), '//registry.example.com/:_authToken=npm_homevalue');
        await writeFile(
            join(project, '.npmrc'),
            '//registry.example.com/:_authToken=npm_projectvalue'
        );

        const auth = await loadAuth(project, home);

        expect(authorizationFor('https://registry.example.com/x', auth)).toBe(
            'Bearer npm_projectvalue'
        );
        expect(auth.secrets).toEqual(['npm_homevalue', 'npm_projectvalue']);
    });

    it('returns nothing when there is no .npmrc anywhere', async () => {
        const empty = await mkdtemp(join(tmpdir(), 'lfg-none-'));

        expect(await loadAuth(empty, empty)).toEqual({ credentials: [], secrets: [] });
    });
});
