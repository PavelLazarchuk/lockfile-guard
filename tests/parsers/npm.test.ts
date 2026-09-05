import { describe, expect, it } from 'vitest';
import { packageNameFromPath, parseNpmLock } from '../../src/parsers/npm';
import { ParseError } from '../../src/parsers/errors';
import { fixture } from '../helpers';

describe('parseNpmLock', () => {
    const lock = parseNpmLock(fixture('npm/base.package-lock.json'));

    it('reads lockfileVersion 3 into the normalized model', () => {
        expect(lock.kind).toBe('npm');
        expect(lock.lockfileVersion).toBe('3');
        expect(lock.packages.map(pkg => `${pkg.name}@${pkg.version}`)).toEqual([
            'esbuild@0.24.0',
            'left-pad@1.3.0',
            'tiny-helper@2.0.0',
            'vitest@2.0.0',
        ]);
    });

    it('marks dependencies declared by the root as direct', () => {
        const byName = new Map(lock.packages.map(pkg => [pkg.name, pkg]));

        expect(byName.get('esbuild')?.direct).toBe(true);
        expect(byName.get('tiny-helper')?.direct).toBe(false);
        expect(byName.get('vitest')?.dev).toBe(true);
        expect(byName.get('esbuild')?.dev).toBe(false);
    });

    it('accepts lockfileVersion 2 and keeps nested paths', () => {
        const legacy = parseNpmLock(fixture('npm/v2.package-lock.json'));

        expect(legacy.lockfileVersion).toBe('2');
        expect(legacy.packages.map(pkg => pkg.path)).toContain(
            'node_modules/left-pad/node_modules/nested-dep'
        );
    });

    it('names a nested package after the last node_modules hop', () => {
        expect(packageNameFromPath('node_modules/a/node_modules/@scope/b')).toBe('@scope/b');
        expect(packageNameFromPath('packages/api')).toBe('packages/api');
    });

    it('skips workspace links but still counts their dependencies as direct', () => {
        const monorepo = parseNpmLock(fixture('npm/workspaces.package-lock.json'));
        const names = monorepo.packages.map(pkg => pkg.name);

        expect(names).not.toContain('@demo/api');
        expect(names).toEqual(['left-pad', 'vitest', 'from-git']);
        expect(monorepo.packages.find(pkg => pkg.name === 'left-pad')?.direct).toBe(true);
    });

    it('keeps git resolutions, which carry no integrity', () => {
        const monorepo = parseNpmLock(fixture('npm/workspaces.package-lock.json'));
        const git = monorepo.packages.find(pkg => pkg.name === 'from-git');

        expect(git?.resolved).toBe('git+ssh://git@github.com/acme/from-git.git#0f9e8d7');
        expect(git?.integrity).toBeUndefined();
    });

    it('refuses lockfileVersion 1 with an actionable message', () => {
        expect(() => parseNpmLock(fixture('npm/v1.package-lock.json'))).toThrow(
            /lockfileVersion 1.*npm 7\+/s
        );
    });

    it.each([
        ['not json at all', /not valid JSON/],
        ['[]', /must contain a JSON object/],
        ['{"packages":{}}', /no numeric lockfileVersion/],
        ['{"lockfileVersion":3}', /no "packages" map/],
    ])('rejects %s', (source, message) => {
        expect(() => parseNpmLock(source)).toThrow(ParseError);
        expect(() => parseNpmLock(source)).toThrow(message);
    });

    it('ignores entries with no version, which are links in disguise', () => {
        const lock = parseNpmLock(
            '{"lockfileVersion":3,"packages":{"node_modules/x":{"resolved":"../x"}}}'
        );

        expect(lock.packages).toEqual([]);
    });
});
