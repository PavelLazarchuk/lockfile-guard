import { describe, expect, it } from 'vitest';
import { parsePnpmKey, parsePnpmLock } from '../../src/parsers/pnpm';
import { fixture } from '../helpers';

describe('parsePnpmKey', () => {
    it.each([
        ['esbuild@0.24.0', 'esbuild', '0.24.0'],
        ['@scope/tiny@2.0.0', '@scope/tiny', '2.0.0'],
        ['/left-pad@1.3.0', 'left-pad', '1.3.0'],
        ['/vitest@2.0.0(happy-dom@14.0.0)', 'vitest', '2.0.0'],
        ['/left-pad/1.3.0', 'left-pad', '1.3.0'],
        ['/@scope/tiny/2.0.0', '@scope/tiny', '2.0.0'],
        ['/vitest/2.0.0_react@18.2.0', 'vitest', '2.0.0'],
    ])('reads %s', (key, name, version) => {
        expect(parsePnpmKey(key)).toEqual({ name, version });
    });

    it('returns null for a key with no version at all', () => {
        expect(parsePnpmKey('just-a-name')).toBeNull();
    });
});

describe('parsePnpmLock', () => {
    it('reads a v9 lockfile, taking dev-ness from the importers', () => {
        const lock = parsePnpmLock(fixture('pnpm/base-v9.pnpm-lock.yaml'));
        const byName = new Map(lock.packages.map(pkg => [pkg.name, pkg]));

        expect(lock.kind).toBe('pnpm');
        expect(lock.lockfileVersion).toBe('9.0');
        expect(byName.get('esbuild')).toMatchObject({
            version: '0.24.0',
            direct: true,
            dev: false,
        });
        expect(byName.get('vitest')).toMatchObject({ dev: true, direct: true });
        expect(byName.get('@scope/tiny')).toMatchObject({ direct: false, dev: false });
    });

    it('reads a v6 lockfile with its per-entry dev flags', () => {
        const lock = parsePnpmLock(fixture('pnpm/v6.pnpm-lock.yaml'));
        const byName = new Map(lock.packages.map(pkg => [pkg.name, pkg]));

        expect(lock.lockfileVersion).toBe('6.0');
        expect(byName.get('vitest')).toMatchObject({ version: '2.0.0', dev: true, direct: true });
        expect(byName.get('@scope/tiny')).toMatchObject({ dev: false, direct: false });
    });

    it('reads a v5.4 lockfile with slash-separated versions', () => {
        const lock = parsePnpmLock(fixture('pnpm/v5.pnpm-lock.yaml'));

        expect(lock.lockfileVersion).toBe('5.4');
        expect(lock.packages.map(pkg => `${pkg.name}@${pkg.version}`)).toEqual([
            'left-pad@1.3.0',
            '@scope/tiny@2.0.0',
            'vitest@2.0.0',
        ]);
    });

    it('keeps a tarball resolution when the entry has one', () => {
        const lock = parsePnpmLock(fixture('pnpm/head-v9.pnpm-lock.yaml'));

        expect(lock.packages.find(pkg => pkg.name === '@scope/tiny')?.resolved).toBe(
            'https://evil-registry.example.com/@scope/tiny/-/tiny-2.0.0.tgz'
        );
        expect(lock.packages.find(pkg => pkg.name === 'esbuild')?.resolved).toBeUndefined();
    });

    it.each([
        ['\t- broken: [yaml', /not valid YAML/],
        ['- a\n- b\n', /must contain a YAML mapping/],
        ['packages: {}\n', /no lockfileVersion/],
    ])('rejects %s', (source, message) => {
        expect(() => parsePnpmLock(source)).toThrow(message);
    });

    it('skips keys it cannot read rather than failing the run', () => {
        const lock = parsePnpmLock("lockfileVersion: '9.0'\npackages:\n  mystery: {}\n");

        expect(lock.packages).toEqual([]);
    });
});
