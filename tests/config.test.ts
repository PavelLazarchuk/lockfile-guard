import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CONFIG_FILENAME,
    ConfigError,
    DEFAULT_CONFIG,
    isIgnored,
    loadConfigFile,
    matchesGlob,
    mergeConfig,
    parseConfig,
    stripJsonComments,
} from '../src/config';
import { config } from './helpers';

async function withConfig(source: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lfg-config-'));
    await writeFile(join(dir, CONFIG_FILENAME), source);

    return dir;
}

describe('stripJsonComments', () => {
    it('leaves the // inside a registry URL alone', () => {
        const source = '{ // note\n "registries": ["https://registry.npmjs.org"] /* trailing */ }';

        expect(JSON.parse(stripJsonComments(source))).toEqual({
            registries: ['https://registry.npmjs.org'],
        });
    });

    it('does not treat an escaped quote as the end of a string', () => {
        expect(JSON.parse(stripJsonComments('{"a":"say \\"hi\\" // not a comment"}')).a).toBe(
            'say "hi" // not a comment'
        );
    });
});

describe('parseConfig', () => {
    it('accepts the documented shape', () => {
        expect(
            parseConfig({
                registries: ['https://registry.npmjs.org'],
                freshnessHours: 48,
                minWeeklyDownloads: 500,
                maxTransitiveAgeDays: 14,
                ignore: ['@my-org/**'],
                failOn: 'critical',
                rules: { deprecated: 'off', 'new-transitive': 'medium' },
                offline: true,
                strictAge: true,
                failOnNetworkError: true,
                concurrency: 4,
                timeoutMs: 500,
                cacheDir: false,
            })
        ).toMatchObject({ failOn: 'critical', rules: { deprecated: 'off' }, cacheDir: false });
    });

    it.each([
        [{ registries: 'nope' }, /registries must be an array/],
        [{ registries: ['not a url'] }, /invalid URL/],
        [{ freshnessHours: -1 }, /non-negative/],
        [{ ignore: [1] }, /ignore must be an array/],
        [{ failOn: 'whenever' }, /failOn must be one of/],
        [{ rules: [] }, /rules must be an object/],
        [{ rules: { deprecated: 'loud' } }, /rules.deprecated must be one of/],
        [{ offline: 'yes' }, /offline must be a boolean/],
        [{ cacheDir: 3 }, /cacheDir must be a path or false/],
        [{ timeoutMs: 0 }, /timeoutMs must be at least 1/],
        [{ concurrency: 0 }, /concurrency must be at least 1/],
    ])('rejects %o', (raw, message) => {
        expect(() => parseConfig(raw)).toThrow(ConfigError);
        expect(() => parseConfig(raw)).toThrow(message);
    });

    it('rejects a file that is not an object', () => {
        expect(() => parseConfig([])).toThrow(/must contain a JSON object/);
    });
});

describe('loadConfigFile', () => {
    it('reads the default filename when it is there', async () => {
        const dir = await withConfig('{ "failOn": "medium" }');

        expect(await loadConfigFile(dir)).toEqual({ failOn: 'medium' });
    });

    it('treats a missing default file as zero configuration', async () => {
        expect(await loadConfigFile(await mkdtemp(join(tmpdir(), 'lfg-empty-')))).toEqual({});
    });

    it('fails on an explicit path that is not there', async () => {
        await expect(loadConfigFile(process.cwd(), 'no-such.json')).rejects.toThrow(
            /Cannot read config file/
        );
    });

    it('fails on a config file that is not JSON', async () => {
        const dir = await withConfig('{ oops');

        await expect(loadConfigFile(dir)).rejects.toThrow(/is not valid JSON/);
    });

    it('accepts an absolute explicit path', async () => {
        const dir = await withConfig('{ "failOn": "low" }');

        expect(await loadConfigFile(process.cwd(), join(dir, CONFIG_FILENAME))).toEqual({
            failOn: 'low',
        });
    });
});

describe('mergeConfig', () => {
    it('layers file config under CLI overrides', () => {
        expect(mergeConfig({ failOn: 'low', offline: true }, { failOn: 'critical' })).toMatchObject(
            {
                failOn: 'critical',
                offline: true,
                freshnessHours: DEFAULT_CONFIG.freshnessHours,
            }
        );
    });

    it('ignores keys that were explicitly left undefined', () => {
        expect(mergeConfig({ failOn: undefined }).failOn).toBe(DEFAULT_CONFIG.failOn);
    });
});

describe('matchesGlob', () => {
    it.each([
        ['@my-org/thing', '@my-org/**', true],
        ['@my-org/deep/thing', '@my-org/**', true],
        ['@my-org/deep/thing', '@my-org/*', false],
        ['left-pad', 'left-*', true],
        ['left-pad', '*', true],
        ['left.pad', 'left.pad', true],
        ['leftxpad', 'left.pad', false],
        ['other', '@my-org/**', false],
    ])('%s vs %s', (name, pattern, expected) => {
        expect(matchesGlob(name, pattern)).toBe(expected);
    });

    it('drives the ignore list', () => {
        expect(isIgnored('@my-org/api', config({ ignore: ['@my-org/**'] }))).toBe(true);
        expect(isIgnored('left-pad', config({ ignore: ['@my-org/**'] }))).toBe(false);
    });
});
