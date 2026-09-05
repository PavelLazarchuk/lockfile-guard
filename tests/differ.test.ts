import { describe, expect, it } from 'vitest';
import { diffLockfiles } from '../src/differ';
import type { Lockfile, Package } from '../src/model';
import { parseNpmLock } from '../src/parsers/npm';
import { fixture, pkg } from './helpers';

function lock(...packages: Package[]): Lockfile {
    return { kind: 'npm', lockfileVersion: '3', packages };
}

describe('diffLockfiles', () => {
    it('classifies a real base/head pair', () => {
        const base = parseNpmLock(fixture('npm/base.package-lock.json'));
        const head = parseNpmLock(fixture('npm/head.package-lock.json'));

        expect(
            diffLockfiles(base, head).map(change =>
                change.kind === 'added' || change.kind === 'removed'
                    ? `${change.kind} ${change.pkg.name}`
                    : `${change.kind} ${change.to.name}`
            )
        ).toEqual([
            'added obscure-helper',
            'added unsigned-thing',
            'version-changed esbuild',
            'resolution-changed tiny-helper',
            'integrity-changed vitest',
            'removed left-pad',
        ]);
    });

    it('reports nothing when the lockfiles are identical', () => {
        const same = parseNpmLock(fixture('npm/base.package-lock.json'));

        expect(diffLockfiles(same, parseNpmLock(fixture('npm/base.package-lock.json')))).toEqual(
            []
        );
    });

    it('does not invent two bumps when a hoist moves both coexisting versions', () => {
        const base = lock(
            pkg({ name: 'a', version: '2.0.0', path: 'node_modules/x/node_modules/a' }),
            pkg({ name: 'a', version: '1.0.0', path: 'node_modules/y/node_modules/a' })
        );
        const head = lock(
            pkg({ name: 'a', version: '1.0.0', path: 'node_modules/a' }),
            pkg({ name: 'a', version: '2.0.0', path: 'node_modules/z/node_modules/a' })
        );

        expect(diffLockfiles(base, head)).toEqual([]);
    });

    it('follows a package that moved in the tree instead of calling it add + remove', () => {
        const base = lock(
            pkg({ name: 'a', version: '1.0.0', path: 'node_modules/x/node_modules/a' })
        );
        const head = lock(pkg({ name: 'a', version: '2.0.0', path: 'node_modules/a' }));
        const [change] = diffLockfiles(base, head);

        expect(change).toMatchObject({ kind: 'version-changed', from: { version: '1.0.0' } });
    });

    it('pairs duplicates of one name one at a time and leaves the rest as add or remove', () => {
        const base = lock(
            pkg({ name: 'a', version: '1.0.0', path: 'node_modules/x/node_modules/a' }),
            pkg({ name: 'a', version: '1.5.0', path: 'node_modules/y/node_modules/a' })
        );
        const head = lock(pkg({ name: 'a', version: '2.0.0', path: 'node_modules/a' }));

        expect(diffLockfiles(base, head).map(change => change.kind)).toEqual([
            'version-changed',
            'removed',
        ]);
    });

    it('sees only the most significant difference of a pair', () => {
        const base = lock(pkg({ integrity: 'sha512-old==', resolved: 'https://a.example/x.tgz' }));
        const head = lock(pkg({ integrity: 'sha512-new==', resolved: 'https://b.example/x.tgz' }));

        expect(diffLockfiles(base, head).map(change => change.kind)).toEqual([
            'resolution-changed',
        ]);
    });

    it('ignores a dev-flag flip, which is not a supply-chain event', () => {
        const base = lock(pkg({ dev: false }));
        const head = lock(pkg({ dev: true }));

        expect(diffLockfiles(base, head)).toEqual([]);
    });

    it('sorts deterministically by kind, then name, then path', () => {
        const base = lock();
        const head = lock(
            pkg({ name: 'zzz', path: 'node_modules/zzz' }),
            pkg({ name: 'aaa', path: 'node_modules/b/node_modules/aaa' }),
            pkg({ name: 'aaa', path: 'node_modules/aaa' })
        );

        expect(
            diffLockfiles(base, head).map(change =>
                change.kind === 'added' ? change.pkg.path : ''
            )
        ).toEqual(['node_modules/aaa', 'node_modules/b/node_modules/aaa', 'node_modules/zzz']);
    });
});
